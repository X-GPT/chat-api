import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { Sandbox } from "e2b";
import { apiEnv } from "@/config/env";
import { SandboxCreationError } from "./errors";

export interface SyncLogger {
	info(obj: Record<string, unknown>): void;
	error(obj: Record<string, unknown>): void;
}

export const WORKSPACE_ROOT = "/workspace";
const DAEMON_PORT = 8080;
const DAEMON_STARTUP_TIMEOUT_MS = 15_000;
const DAEMON_HEALTH_CHECK_INTERVAL_MS = 500;

// Three separate bundles deployed into the sandbox. Versioned together by
// the hash of all three concatenated — any change to any one triggers a
// daemon restart. The daemon spawns sync.js / agent.js per turn; only the
// daemon bundle is long-running.
const DAEMON_BUNDLE = {
	name: "daemon",
	sandboxPath: "/workspace/daemon.js",
	distFile: "daemon.js",
} as const;
const SYNC_BUNDLE = {
	name: "sync",
	sandboxPath: "/workspace/sync.js",
	distFile: "sync.js",
} as const;
const AGENT_BUNDLE = {
	name: "agent",
	sandboxPath: "/workspace/agent.js",
	distFile: "agent.js",
} as const;
const SANDBOX_BUNDLES = [DAEMON_BUNDLE, SYNC_BUNDLE, AGENT_BUNDLE] as const;
const DAEMON_BUNDLE_PATH = DAEMON_BUNDLE.sandboxPath;
const DIST_DIR = resolve(
	import.meta.dirname,
	"../../../../sandbox-daemon/dist",
);

interface SandboxBundleSet {
	files: Array<{ sandboxPath: string; code: string }>;
	version: string;
}

export interface SandboxDaemonEndpoint {
	url: string;
	authToken: string;
}

let bundlePromise: Promise<SandboxBundleSet> | null = null;

function getSandboxBundles(): Promise<SandboxBundleSet> {
	if (!bundlePromise) bundlePromise = loadSandboxBundles();
	return bundlePromise;
}

async function loadSandboxBundles(): Promise<SandboxBundleSet> {
	const files: SandboxBundleSet["files"] = [];
	const hasher = new Bun.CryptoHasher("sha256");
	for (const { name, sandboxPath, distFile } of SANDBOX_BUNDLES) {
		const path = `${DIST_DIR}/${distFile}`;
		let code: string;
		try {
			code = await Bun.file(path).text();
		} catch (err) {
			throw new Error(
				`Prebuilt ${name} bundle missing at ${path}. Run \`bun run build:daemon\` from apps/chat-api.`,
				{ cause: err },
			);
		}
		hasher.update(code);
		files.push({ sandboxPath, code });
	}
	const version = hasher.digest("hex").slice(0, 12);
	return { files, version };
}

export class SandboxManager {
	private readonly daemonAuthTokens = new Map<string, string>();

	private getOrCreateDaemonAuthToken(sandbox: Sandbox): {
		token: string;
		existed: boolean;
	} {
		const existing = this.daemonAuthTokens.get(sandbox.sandboxId);
		if (existing) return { token: existing, existed: true };

		const token = randomBytes(32).toString("hex");
		this.daemonAuthTokens.set(sandbox.sandboxId, token);
		return { token, existed: false };
	}

	async getOrCreateSandbox(
		userId: string,
		sandboxId: string | null,
		logger: SyncLogger,
	): Promise<Sandbox> {
		if (sandboxId) {
			try {
				const info = await Sandbox.getInfo(sandboxId);
				if (info.metadata.userId === userId) {
					logger.info({
						msg: "Reconnecting to sandbox from request",
						userId,
						sandboxId,
					});
					return await Sandbox.connect(sandboxId);
				}
				logger.error({
					msg: "Sandbox userId mismatch, creating new sandbox",
					userId,
					sandboxId,
				});
			} catch (err) {
				logger.error({
					msg: "Failed to reconnect, creating new sandbox",
					userId,
					sandboxId,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		logger.info({ msg: "Creating sandbox", userId });

		try {
			const sandbox = await Sandbox.create(apiEnv.E2B_TEMPLATE, {
				metadata: { userId },
			});

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
	): Promise<SandboxDaemonEndpoint> {
		const daemonUrl = this.getDaemonUrl(sandbox);
		const auth = this.getOrCreateDaemonAuthToken(sandbox);

		const bundles = await getSandboxBundles();

		if (auth.existed) {
			try {
				const health = await this.checkDaemonHealth(daemonUrl);
				if (health && health.version === bundles.version) {
					return { url: daemonUrl, authToken: auth.token };
				}

				if (health) {
					logger.info({
						msg: "Daemon version mismatch, restarting",
						currentVersion: health.version,
						expectedVersion: bundles.version,
					});
					await this.restartDaemon(sandbox, logger, bundles, auth.token);
					return { url: daemonUrl, authToken: auth.token };
				}
			} catch {
				// Daemon not running, deploy it
			}
		} else {
			logger.info({
				msg: "No local daemon auth token for sandbox, restarting daemon",
				userId,
				sandboxId: sandbox.sandboxId,
			});
			await this.restartDaemon(sandbox, logger, bundles, auth.token);
			return { url: daemonUrl, authToken: auth.token };
		}

		logger.info({
			msg: "Deploying sandbox daemon",
			userId,
			sandboxId: sandbox.sandboxId,
		});

		await this.deploySandboxBundles(sandbox, logger, bundles, auth.token);
		return { url: daemonUrl, authToken: auth.token };
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

	private async deploySandboxBundles(
		sandbox: Sandbox,
		logger: SyncLogger,
		bundles: SandboxBundleSet,
		authToken: string,
	): Promise<void> {
		await sandbox.files.write(
			bundles.files.map(({ sandboxPath, code }) => ({
				path: sandboxPath,
				data: code,
			})),
		);

		await this.startDaemonProcess(sandbox, logger, bundles.version, authToken);
	}

	private async restartDaemon(
		sandbox: Sandbox,
		logger: SyncLogger,
		bundles: SandboxBundleSet,
		authToken: string,
	): Promise<void> {
		// Kill whatever process owns port 8080 (process name may not match pkill pattern)
		await sandbox.commands.run("kill $(lsof -ti :8080) 2>/dev/null || true", {
			timeoutMs: 5_000,
		});

		// Re-deploy with updated bundles
		await this.deploySandboxBundles(sandbox, logger, bundles, authToken);
	}

	private async startDaemonProcess(
		sandbox: Sandbox,
		logger: SyncLogger,
		expectedVersion: string,
		authToken: string,
	): Promise<void> {
		await sandbox.commands.run(
			`bun ${DAEMON_BUNDLE_PATH} >> /workspace/daemon.log 2>&1`,
			{
				background: true,
				envs: {
					ANTHROPIC_API_KEY: apiEnv.ANTHROPIC_API_KEY,
					DATABASE_URL: apiEnv.DATABASE_URL as string,
					DAEMON_VERSION: expectedVersion,
					DAEMON_AUTH_TOKEN: authToken,
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
