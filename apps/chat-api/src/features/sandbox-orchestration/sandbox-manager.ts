import { Sandbox } from "e2b";
import { apiEnv } from "@/config/env";
import type { SyncLogger } from "@/features/sandbox";
import { getDocsRoot } from "@/features/sandbox";
import { SandboxCreationError } from "./errors";

export const WORKSPACE_ROOT = "/workspace/sandbox-prototype";

export class SandboxManager {
	// Cache sandboxId per user to avoid Sandbox.list() API call on every request.
	// Invalidated on connect failure or killSandbox.
	private sandboxIdCache = new Map<string, string>();
	// Dedup concurrent getOrCreateSandbox calls for the same user.
	private inFlight = new Map<string, Promise<Sandbox>>();

	async getOrCreateSandbox(
		userId: string,
		logger: SyncLogger,
	): Promise<Sandbox> {
		const existing = this.inFlight.get(userId);
		if (existing) return existing;

		const promise = this._getOrCreateSandbox(userId, logger).finally(() => {
			this.inFlight.delete(userId);
		});
		this.inFlight.set(userId, promise);
		return promise;
	}

	private async _getOrCreateSandbox(
		userId: string,
		logger: SyncLogger,
	): Promise<Sandbox> {
		const cachedId = this.sandboxIdCache.get(userId);
		if (cachedId) {
			try {
				return await Sandbox.connect(cachedId);
			} catch {
				this.sandboxIdCache.delete(userId);
			}
		}

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

	getDocsRoot(userId: string): string {
		return getDocsRoot({ workspaceRoot: WORKSPACE_ROOT, userId });
	}

	getCachedSandboxId(userId: string): string | undefined {
		return this.sandboxIdCache.get(userId);
	}
}
