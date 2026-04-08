import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { Sandbox } from "e2b";
import { apiEnv } from "@/config/env";
import type { SyncLogger } from "@/features/sandbox";
import { SandboxCreationError } from "./errors";

export const WORKSPACE_ROOT = "/workspace";
const DAEMON_PORT = 8080;
const DAEMON_STARTUP_TIMEOUT_MS = 15_000;
const DAEMON_HEALTH_CHECK_INTERVAL_MS = 500;

let cachedDaemonVersion = "";

function getDaemonVersion(): string {
	if (!cachedDaemonVersion) {
		try {
			const pkg = JSON.parse(
				readFileSync(
					resolve(
						import.meta.dirname,
						"../../../../sandbox-daemon/package.json",
					),
					"utf-8",
				),
			);
			cachedDaemonVersion = String(pkg.version ?? "0.0.0");
		} catch {
			cachedDaemonVersion = "0.0.0";
		}
	}
	return cachedDaemonVersion;
}

let cachedDaemonBundle: Array<{ path: string; data: string }> | null = null;

function getDaemonBundle(): Array<{ path: string; data: string }> {
	if (cachedDaemonBundle) return cachedDaemonBundle;
	const daemonDir = resolve(import.meta.dirname, "../../../../sandbox-daemon");
	const files = collectDaemonFiles(daemonDir);
	cachedDaemonBundle = files.map((file) => ({
		path: `/workspace/sandbox-daemon/${file}`,
		data: readFileSync(resolve(daemonDir, file), "utf-8"),
	}));
	return cachedDaemonBundle;
}

const DAEMON_SKIP = new Set(["node_modules", ".git", "biome.json"]);
const DAEMON_EXTENSIONS = new Set([".ts", ".json", ".lock"]);

/**
 * Recursively collect deployable files from the daemon directory.
 * Skips node_modules, test files, and config files not needed at runtime.
 */
function collectDaemonFiles(dir: string, base = dir): string[] {
	const results: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (DAEMON_SKIP.has(entry)) continue;
		const fullPath = join(dir, entry);
		const relPath = relative(base, fullPath);
		if (statSync(fullPath).isDirectory()) {
			results.push(...collectDaemonFiles(fullPath, base));
		} else if (
			DAEMON_EXTENSIONS.has(relPath.slice(relPath.lastIndexOf("."))) &&
			!relPath.endsWith(".test.ts")
		) {
			results.push(relPath);
		}
	}
	return results;
}

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

	getCachedSandboxId(userId: string): string | undefined {
		return this.sandboxIdCache.get(userId);
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

		try {
			const health = await this.checkDaemonHealth(daemonUrl);
			if (health && health.version === getDaemonVersion()) {
				return daemonUrl;
			}

			if (health) {
				logger.info({
					msg: "Daemon version mismatch, restarting",
					currentVersion: health.version,
					expectedVersion: getDaemonVersion(),
				});
				await this.restartDaemon(sandbox, logger);
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

		await this.deployDaemonBundle(sandbox, logger);
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
	): Promise<void> {
		await sandbox.files.write(getDaemonBundle());

		// Install dependencies
		const installResult = await sandbox.commands.run(
			"cd /workspace/sandbox-daemon && bun install",
			{ timeoutMs: 60_000 },
		);

		if (installResult.exitCode !== 0) {
			throw new Error(
				`Daemon dependency install failed: ${installResult.stderr}`,
			);
		}

		// Start daemon in background
		await this.startDaemonProcess(sandbox, logger);
	}

	private async restartDaemon(
		sandbox: Sandbox,
		logger: SyncLogger,
	): Promise<void> {
		// Kill existing daemon
		await sandbox.commands.run("pkill -f 'bun.*sandbox-daemon' || true", {
			timeoutMs: 5_000,
		});

		// Re-deploy with updated files
		await this.deployDaemonBundle(sandbox, logger);
	}

	private async startDaemonProcess(
		sandbox: Sandbox,
		logger: SyncLogger,
	): Promise<void> {
		// Start daemon as a background process using E2B's background option
		await sandbox.commands.run(
			"cd /workspace/sandbox-daemon && bun run index.ts",
			{
				background: true,
				envs: {
					ANTHROPIC_API_KEY: apiEnv.ANTHROPIC_API_KEY,
					DATABASE_URL: apiEnv.DATABASE_URL ?? "",
				},
				onStderr: (data) => {
					logger.error({ msg: "Daemon stderr", data });
				},
			},
		);

		// Wait for health check
		const daemonUrl = this.getDaemonUrl(sandbox);
		const deadline = Date.now() + DAEMON_STARTUP_TIMEOUT_MS;

		while (Date.now() < deadline) {
			const health = await this.checkDaemonHealth(daemonUrl);
			if (health) {
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
