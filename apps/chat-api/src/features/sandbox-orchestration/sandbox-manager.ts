import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Sandbox } from "e2b";
import { apiEnv } from "@/config/env";
import { getDocsRoot } from "@/features/sandbox";
import type { SyncLogger } from "@/features/sandbox/sandbox-sync.service";
import { SandboxCreationError, SandboxSyncError } from "./errors";
import type { SyncStatus } from "./sync-types";

const SYNC_RUNNER_PATH = "/workspace/sandbox-prototype/sync-runner.mjs";
const SYNC_REQUEST_PATH = "/workspace/sandbox-prototype/sync-request.json";
const SYNC_STATUS_PATH = "/workspace/.sync-status.json";
const WORKSPACE_ROOT = "/workspace/sandbox-prototype";

let cachedSyncRunnerSource: string | null = null;

function getSyncRunnerSource(): string {
	if (!cachedSyncRunnerSource) {
		const sourcePath = resolve(
			import.meta.dirname,
			"../sandbox-sync/sync-runner.mjs",
		);
		cachedSyncRunnerSource = readFileSync(sourcePath, "utf-8");
	}
	return cachedSyncRunnerSource;
}

export class SandboxManager {
	// Cache sandboxId per user to avoid Sandbox.list() API call on every request.
	// Invalidated on connect failure or killSandbox.
	private sandboxIdCache = new Map<string, string>();

	async getOrCreateSandbox(
		userId: string,
		logger: SyncLogger,
	): Promise<Sandbox> {
		// Try cached sandboxId first — avoids E2B list API call
		const cachedId = this.sandboxIdCache.get(userId);
		if (cachedId) {
			try {
				return await Sandbox.connect(cachedId);
			} catch {
				this.sandboxIdCache.delete(userId);
			}
		}

		// Cache miss — query E2B for existing sandbox
		const paginator = Sandbox.list({
			query: {
				metadata: { userId },
				state: ["running", "paused"],
			},
			limit: 1,
		});

		const existing = await paginator.nextItems();
		const info = existing[0];
		if (info) {
			logger.info({
				msg: "Reconnecting to existing sandbox",
				userId,
				sandboxId: info.sandboxId,
			});

			try {
				this.sandboxIdCache.set(userId, info.sandboxId);
				return await Sandbox.connect(info.sandboxId);
			} catch (err) {
				this.sandboxIdCache.delete(userId);
				logger.error({
					msg: "Failed to reconnect, creating new sandbox",
					userId,
					sandboxId: info.sandboxId,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		logger.info({ msg: "Creating sandbox", userId });

		try {
			const sandbox = await Sandbox.create(apiEnv.E2B_TEMPLATE, {
				metadata: { userId },
			});

			this.sandboxIdCache.set(userId, sandbox.sandboxId);
			logger.info({
				msg: "Sandbox created",
				userId,
				sandboxId: sandbox.sandboxId,
			});

			return sandbox;
		} catch (err) {
			throw new SandboxCreationError(
				`Failed to create sandbox for user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	async killSandbox(
		userId: string,
		sandbox: Sandbox,
		logger: SyncLogger,
	): Promise<void> {
		this.sandboxIdCache.delete(userId);
		try {
			await sandbox.kill();
			logger.info({
				msg: "Sandbox killed",
				userId,
				sandboxId: sandbox.sandboxId,
			});
		} catch (err) {
			logger.error({
				msg: "Failed to kill sandbox",
				userId,
				sandboxId: sandbox.sandboxId,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	/**
	 * Writes a "syncing" status before launch to prevent stale-ready races.
	 */
	async triggerSync(
		userId: string,
		sandbox: Sandbox,
		syncEndpointOrigin: string,
		logger: SyncLogger,
	): Promise<void> {
		const docsRoot = this.getDocsRoot(userId);

		const syncRunnerSource = getSyncRunnerSource();
		const syncRequest = JSON.stringify({
			syncEndpoint: `${syncEndpointOrigin}/internal/sync`,
			userId,
			docsRoot,
		});

		logger.info({ msg: "Triggering sync", userId, docsRoot });

		await sandbox.files.write(
			SYNC_STATUS_PATH,
			JSON.stringify({
				status: "syncing",
				timestamp: new Date().toISOString(),
			}),
		);

		await Promise.all([
			sandbox.files.write(SYNC_RUNNER_PATH, syncRunnerSource),
			sandbox.files.write(SYNC_REQUEST_PATH, syncRequest),
		]);

		// Fire-and-forget — we poll .sync-status.json via waitForSync
		sandbox.commands
			.run(`node ${SYNC_RUNNER_PATH} ${SYNC_REQUEST_PATH}`, {
				timeoutMs: 300_000,
			})
			.catch((err) => {
				logger.error({
					msg: "Sync runner process failed",
					userId,
					error: err instanceof Error ? err.message : String(err),
				});
			});
	}

	async checkSyncStatus(sandbox: Sandbox): Promise<SyncStatus | null> {
		try {
			const content = await sandbox.files.read(SYNC_STATUS_PATH);
			return JSON.parse(content) as SyncStatus;
		} catch {
			return null;
		}
	}

	async waitForSync(sandbox: Sandbox, timeoutMs: number): Promise<SyncStatus> {
		const start = Date.now();
		const pollIntervalMs = 1000;

		while (Date.now() - start < timeoutMs) {
			const status = await this.checkSyncStatus(sandbox);

			if (status?.status === "ready") {
				return status;
			}

			if (status?.status === "error") {
				throw new SandboxSyncError(`Sync failed: ${status.message}`);
			}

			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}

		throw new SandboxSyncError(`Sync timed out after ${timeoutMs}ms`);
	}

	async ensureReady(
		userId: string,
		syncEndpointOrigin: string,
		logger: SyncLogger,
	): Promise<Sandbox> {
		const sandbox = await this.getOrCreateSandbox(userId, logger);
		const status = await this.checkSyncStatus(sandbox);

		if (status?.status === "ready") {
			return sandbox;
		}

		if (status?.status === "syncing") {
			logger.info({ msg: "Sync in progress, waiting", userId });
			await this.waitForSync(sandbox, 300_000);
			return sandbox;
		}

		await this.triggerSync(userId, sandbox, syncEndpointOrigin, logger);
		await this.waitForSync(sandbox, 300_000);

		return sandbox;
	}

	getDocsRoot(userId: string): string {
		return getDocsRoot({ workspaceRoot: WORKSPACE_ROOT, userId });
	}
}
