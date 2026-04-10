import { resolve } from "node:path";
import { Sandbox } from "e2b";
import { apiEnv } from "@/config/env";
import { getRuntime, upsertRuntime } from "@/db/user-runtime";
import { clearUserSessions } from "@/db/user-sessions";
import type { SyncLogger } from "@/features/sandbox";
import { SandboxCreationError } from "./errors";

export const WORKSPACE_ROOT = "/workspace";
const DAEMON_PORT = 8080;
const DAEMON_STARTUP_TIMEOUT_MS = 15_000;
const DAEMON_HEALTH_CHECK_INTERVAL_MS = 500;
const DAEMON_BUNDLE_PATH = "/workspace/daemon.js";

let bundlePromise: Promise<{ code: string; version: string }> | null = null;

/**
 * Build the daemon into a single JS bundle using Bun.build().
 * Runs once at first request, cached for process lifetime.
 * Caches the promise to prevent duplicate builds on concurrent cold-start calls.
 */
function getDaemonBundle(): Promise<{ code: string; version: string }> {
	if (!bundlePromise) {
		bundlePromise = buildDaemonBundle().catch((err) => {
			bundlePromise = null;
			throw err;
		});
	}
	return bundlePromise;
}

async function buildDaemonBundle(): Promise<{ code: string; version: string }> {
	const entrypoint = resolve(
		import.meta.dirname,
		"../../../../sandbox-daemon/index.ts",
	);
	const result = await Bun.build({
		entrypoints: [entrypoint],
		target: "bun",
		minify: true,
	});
	if (!result.success) {
		throw new Error(
			`Daemon build failed: ${result.logs.map((l) => l.message).join("\n")}`,
		);
	}
	const output = result.outputs[0];
	if (!output) {
		throw new Error("Daemon build produced no output");
	}
	const code = await output.text();
	const version = new Bun.CryptoHasher("sha256")
		.update(code)
		.digest("hex")
		.slice(0, 12);
	return { code, version };
}

export class SandboxManager {
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
		const runtime = await getRuntime(userId);
		if (runtime?.sandbox_id) {
			logger.info({
				msg: "Reconnecting to sandbox from Postgres",
				userId,
				sandboxId: runtime.sandbox_id,
			});

			try {
				return await Sandbox.connect(runtime.sandbox_id);
			} catch (err) {
				logger.error({
					msg: "Failed to reconnect from Postgres, creating new sandbox",
					userId,
					sandboxId: runtime.sandbox_id,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		logger.info({ msg: "Creating sandbox", userId });

		try {
			const sandbox = await Sandbox.create(apiEnv.E2B_TEMPLATE, {
				metadata: { userId },
			});

			await Promise.all([
				upsertRuntime(userId, { sandbox_id: sandbox.sandboxId }),
				clearUserSessions(userId).catch(() => {}),
			]);
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
		try {
			await sandbox.kill();
		} catch (err) {
			logger.error({
				msg: "Failed to kill sandbox",
				userId,
				sandboxId: sandbox.sandboxId,
				error: err instanceof Error ? err.message : String(err),
			});
			return;
		}

		await Promise.all([
			upsertRuntime(userId, { sandbox_id: null }).catch(() => {}),
			clearUserSessions(userId).catch(() => {}),
		]);
		logger.info({
			msg: "Sandbox killed",
			userId,
			sandboxId: sandbox.sandboxId,
		});
	}

	/**
	 * Ensure the sandbox daemon is running and up-to-date.
	 * Returns the daemon URL.
	 */
	async ensureSandboxDaemon(
		userId: string,
		sandbox: Sandbox,
		logger: SyncLogger,
	): Promise<string> {
		const daemonUrl = this.getDaemonUrl(sandbox);

		const bundle = await getDaemonBundle();

		try {
			const health = await this.checkDaemonHealth(daemonUrl);
			if (health && health.version === bundle.version) {
				return daemonUrl;
			}

			if (health) {
				logger.info({
					msg: "Daemon version mismatch, restarting",
					currentVersion: health.version,
					expectedVersion: bundle.version,
				});
				await this.restartDaemon(sandbox, logger, bundle);
				return daemonUrl;
			}
		} catch {
			// Daemon not running, deploy it
		}

		logger.info({
			msg: "Deploying sandbox daemon",
			userId,
			sandboxId: sandbox.sandboxId,
		});

		await this.deployDaemonBundle(sandbox, logger, bundle);
		return daemonUrl;
	}

	getDaemonUrl(sandbox: Sandbox): string {
		return `https://${sandbox.getHost(DAEMON_PORT)}`;
	}

	private async checkDaemonHealth(
		daemonUrl: string,
	): Promise<{ status: string; version: string; uptime: number } | null> {
		try {
			const response = await fetch(`${daemonUrl}/health`, {
				signal: AbortSignal.timeout(3_000),
			});
			if (!response.ok) return null;
			const body = (await response.json()) as {
				status: string;
				version: string;
				uptime: number;
			};
			return body;
		} catch {
			return null;
		}
	}

	private async deployDaemonBundle(
		sandbox: Sandbox,
		logger: SyncLogger,
		bundle: { code: string; version: string },
	): Promise<void> {
		await sandbox.files.write([
			{ path: DAEMON_BUNDLE_PATH, data: bundle.code },
		]);

		await this.startDaemonProcess(sandbox, logger, bundle.version);
	}

	private async restartDaemon(
		sandbox: Sandbox,
		logger: SyncLogger,
		bundle: { code: string; version: string },
	): Promise<void> {
		// Kill whatever process owns port 8080 (process name may not match pkill pattern)
		await sandbox.commands.run("kill $(lsof -ti :8080) 2>/dev/null || true", {
			timeoutMs: 5_000,
		});

		// Re-deploy with updated bundle
		await this.deployDaemonBundle(sandbox, logger, bundle);
	}

	private async startDaemonProcess(
		sandbox: Sandbox,
		logger: SyncLogger,
		expectedVersion: string,
	): Promise<void> {
		await sandbox.commands.run(
			`bun ${DAEMON_BUNDLE_PATH} >> /workspace/daemon.log 2>&1`,
			{
				background: true,
				envs: {
					ANTHROPIC_API_KEY: apiEnv.ANTHROPIC_API_KEY,
					DATABASE_URL: apiEnv.DATABASE_URL as string,
					DAEMON_VERSION: expectedVersion,
				},
			},
		);

		const daemonUrl = this.getDaemonUrl(sandbox);
		const deadline = Date.now() + DAEMON_STARTUP_TIMEOUT_MS;

		while (Date.now() < deadline) {
			const health = await this.checkDaemonHealth(daemonUrl);
			if (health && (!expectedVersion || health.version === expectedVersion)) {
				logger.info({
					msg: "Sandbox daemon is ready",
					version: health.version,
				});
				return;
			}
			await new Promise((r) => setTimeout(r, DAEMON_HEALTH_CHECK_INTERVAL_MS));
		}

		throw new Error("Daemon failed to start within timeout");
	}
}
