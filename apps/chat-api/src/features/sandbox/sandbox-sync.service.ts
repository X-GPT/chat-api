import type { Sandbox } from "e2b";
import type { ProtectedSummary } from "@/features/chat/api/types";
import {
	getDocsRoot,
	type MaterializationConfig,
	type MaterializedFile,
	materializeSummaries,
} from "./materialization";
import { diffManifest } from "./sandbox-manifest";
import type { SyncStateRepository } from "./sync-state.repository";
import type {
	ManifestDiff,
	ReconciliationPlan,
	SyncStateRecord,
} from "./sync-state.types";

export interface SyncLogger {
	info(obj: Record<string, unknown>): void;
	error(obj: Record<string, unknown>): void;
}

export interface SandboxSyncServiceDeps {
	repository: SyncStateRepository;
	logger: SyncLogger;
}

function isDeleted(summary: ProtectedSummary): boolean {
	return summary.delFlag === 1 || summary.delFlag === "1";
}

function nowISO(): string {
	return new Date().toISOString();
}

export class SandboxSyncService {
	private readonly repository: SyncStateRepository;
	private readonly logger: SyncLogger;
	private readonly locks = new Map<string, Promise<void>>();

	constructor(deps: SandboxSyncServiceDeps) {
		this.repository = deps.repository;
		this.logger = deps.logger;
	}

	/**
	 * Full reconciliation: compare source summaries against sync-state,
	 * produce a plan, apply it to the sandbox, update sync-state.
	 */
	async syncUser(
		userId: string,
		sandboxId: string,
		sandbox: Sandbox,
		sourceSummaries: ProtectedSummary[],
		config: MaterializationConfig,
	): Promise<ReconciliationPlan> {
		return this.withLock(userId, async () => {
			const plan = await this.buildReconciliationPlan(
				userId,
				sandboxId,
				sourceSummaries,
				config,
			);

			this.logger.info({
				msg: "reconciliation plan built",
				userId,
				sandboxId,
				creates: plan.creates.length,
				updates: plan.updates.length,
				deletes: plan.deletes.length,
				unchanged: plan.unchanged,
			});

			await this.applyPlan(userId, sandboxId, sandbox, plan);

			return plan;
		});
	}

	/**
	 * Build a reconciliation plan without applying it.
	 * Pure comparison: source summaries + current sync-state → plan.
	 */
	async buildReconciliationPlan(
		userId: string,
		sandboxId: string,
		sourceSummaries: ProtectedSummary[],
		config: MaterializationConfig,
	): Promise<ReconciliationPlan> {
		const existingRecords = await this.repository.findByUserId(userId);
		const existingMap = new Map<string, SyncStateRecord>();
		for (const record of existingRecords) {
			existingMap.set(record.summaryId, record);
		}

		// Filter out deleted summaries — they produce delete actions
		const activeSummaries = sourceSummaries.filter((s) => !isDeleted(s));
		const deletedSummaryIds = new Set(
			sourceSummaries.filter(isDeleted).map((s) => s.id),
		);

		const materialized = materializeSummaries(activeSummaries, config);
		const materializedMap = new Map<string, MaterializedFile>();
		for (const file of materialized) {
			materializedMap.set(file.summaryId, file);
		}

		const plan: ReconciliationPlan = {
			creates: [],
			updates: [],
			deletes: [],
			unchanged: 0,
		};

		// Detect creates and updates
		for (const file of materialized) {
			const existing = existingMap.get(file.summaryId);
			const record: SyncStateRecord = {
				userId,
				sandboxId,
				summaryId: file.summaryId,
				type: file.type,
				expectedPath: file.path,
				contentChecksum: file.checksum,
				sourceUpdatedAt:
					activeSummaries.find((s) => s.id === file.summaryId)?.updateTime ??
					nowISO(),
				lastSyncedAt: null,
				syncStatus: "synced",
			};

			if (!existing) {
				plan.creates.push({ kind: "create", record, content: file.content });
			} else if (existing.contentChecksum !== file.checksum) {
				plan.updates.push({
					kind: "update",
					record,
					content: file.content,
					reason: "content_changed",
				});
			} else {
				plan.unchanged++;
			}
		}

		// Detect deletes: existing records not in active source, or explicitly deleted
		for (const existing of existingRecords) {
			if (
				!materializedMap.has(existing.summaryId) ||
				deletedSummaryIds.has(existing.summaryId)
			) {
				plan.deletes.push({ kind: "delete", record: existing });
			}
		}

		return plan;
	}

	/**
	 * Apply a reconciliation plan to the sandbox filesystem and update sync-state.
	 */
	async applyPlan(
		userId: string,
		sandboxId: string,
		sandbox: Sandbox,
		plan: ReconciliationPlan,
	): Promise<void> {
		const timestamp = nowISO();

		// Apply creates and updates
		const writes = [...plan.creates, ...plan.updates];
		for (const action of writes) {
			try {
				await sandbox.files.write(action.record.expectedPath, action.content);
				await this.repository.upsert({
					...action.record,
					lastSyncedAt: timestamp,
					syncStatus: "synced",
				});
			} catch (err) {
				this.logger.error({
					msg: "failed to write file to sandbox",
					userId,
					sandboxId,
					path: action.record.expectedPath,
					error: err instanceof Error ? err.message : String(err),
				});
				await this.repository.upsert({
					...action.record,
					syncStatus: "error",
				});
			}
		}

		// Apply deletes
		if (plan.deletes.length > 0) {
			const paths = plan.deletes.map((d) => d.record.expectedPath);
			try {
				const escapedPaths = paths.map((p) => `'${p}'`).join(" ");
				await sandbox.commands.run(`rm -f ${escapedPaths}`, {
					timeoutMs: 10_000,
				});
				await this.repository.bulkDelete(
					userId,
					plan.deletes.map((d) => d.record.summaryId),
				);
			} catch (err) {
				this.logger.error({
					msg: "failed to delete files from sandbox",
					userId,
					sandboxId,
					paths,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
	}

	/**
	 * Compare sync-state expectations against actual sandbox filesystem.
	 * Returns a drift report.
	 */
	async verifyManifest(
		userId: string,
		sandboxId: string,
		sandbox: Sandbox,
		config: MaterializationConfig,
	): Promise<ManifestDiff> {
		const records = await this.repository.findByUserAndSandbox(
			userId,
			sandboxId,
		);
		const docsRoot = getDocsRoot(config);
		return diffManifest(records, sandbox, docsRoot);
	}

	/**
	 * Repair drift found by verifyManifest.
	 * Re-materializes missing/mismatched files, removes orphans.
	 */
	async repairDrift(
		userId: string,
		sandboxId: string,
		sandbox: Sandbox,
		diff: ManifestDiff,
		sourceSummaries: ProtectedSummary[],
		config: MaterializationConfig,
	): Promise<void> {
		return this.withLock(userId, async () => {
			const summaryMap = new Map<string, ProtectedSummary>();
			for (const s of sourceSummaries) {
				summaryMap.set(s.id, s);
			}
			const timestamp = nowISO();

			// Re-write missing and mismatched files
			const toRepair = [...diff.missingInSandbox, ...diff.checksumMismatches];
			for (const record of toRepair) {
				const summary = summaryMap.get(record.summaryId);
				if (!summary) continue;

				const materialized = materializeSummaries([summary], config);
				if (materialized.length === 0) continue;

				const file = materialized[0];
				try {
					await sandbox.files.write(file.path, file.content);
					await this.repository.upsert({
						...record,
						expectedPath: file.path,
						contentChecksum: file.checksum,
						lastSyncedAt: timestamp,
						syncStatus: "synced",
					});
				} catch (err) {
					this.logger.error({
						msg: "failed to repair file",
						userId,
						sandboxId,
						path: file.path,
						error: err instanceof Error ? err.message : String(err),
					});
				}
			}

			// Remove orphaned files
			if (diff.orphanedInSandbox.length > 0) {
				const escapedPaths = diff.orphanedInSandbox
					.map((p) => `'${p}'`)
					.join(" ");
				try {
					await sandbox.commands.run(`rm -f ${escapedPaths}`, {
						timeoutMs: 10_000,
					});
				} catch (err) {
					this.logger.error({
						msg: "failed to remove orphaned files",
						userId,
						sandboxId,
						paths: diff.orphanedInSandbox,
						error: err instanceof Error ? err.message : String(err),
					});
				}
			}

			this.logger.info({
				msg: "drift repair complete",
				userId,
				sandboxId,
				repairedFiles: toRepair.length,
				removedOrphans: diff.orphanedInSandbox.length,
			});
		});
	}

	/**
	 * Clear all sync-state for the user, delete all sandbox docs,
	 * and perform a full sync from scratch.
	 */
	async rebuildSandbox(
		userId: string,
		sandboxId: string,
		sandbox: Sandbox,
		sourceSummaries: ProtectedSummary[],
		config: MaterializationConfig,
	): Promise<ReconciliationPlan> {
		return this.withLock(userId, async () => {
			const docsRoot = getDocsRoot(config);

			// Clear existing state
			await this.repository.deleteAllForUser(userId);
			await sandbox.commands.run(`rm -rf ${docsRoot}`, { timeoutMs: 10_000 });

			this.logger.info({
				msg: "sandbox cleared for rebuild",
				userId,
				sandboxId,
			});

			// Build and apply a full sync plan (bypass lock since we already hold it)
			const plan = await this.buildReconciliationPlan(
				userId,
				sandboxId,
				sourceSummaries,
				config,
			);
			await this.applyPlan(userId, sandboxId, sandbox, plan);

			return plan;
		});
	}

	/**
	 * Serialize sync operations per userId.
	 * New operations chain onto the previous promise for the same user.
	 */
	private withLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
		const prev = this.locks.get(userId) ?? Promise.resolve();
		const next = prev.then(() => fn());
		this.locks.set(
			userId,
			next.then(
				() => {},
				() => {},
			),
		);
		return next;
	}
}
