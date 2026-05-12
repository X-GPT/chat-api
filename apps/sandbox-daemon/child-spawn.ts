/**
 * Spawn helpers for the per-turn sync.js and agent.js children. The daemon
 * holds DATABASE_URL and ANTHROPIC_API_KEY in its env so it can forward
 * each to the correct child, but never imports the DB driver or the Claude
 * Agent SDK itself — those live exclusively in sync.js / agent.js.
 *
 * Both children speak NDJSON on stdout. We line-buffer, parse, and dispatch.
 *
 * Bundle paths are env-overridable for tests; in production sandboxes the
 * chat-api writes the three bundles to /workspace/{daemon,sync,agent}.js.
 */

import type { AgentEvent, SyncEvent } from "./ipc-protocol";

export type { AgentEvent, SyncEvent } from "./ipc-protocol";
export type SyncResult = SyncEvent;

// Resolved at call time so tests can swap env vars per scenario.
const getSyncBundlePath = () =>
	process.env.SANDBOX_SYNC_PATH ?? "/workspace/sync.js";
const getAgentBundlePath = () =>
	process.env.SANDBOX_AGENT_PATH ?? "/workspace/agent.js";
const getBunExecutable = () => process.env.SANDBOX_BUN_PATH ?? "bun";

// Sync is bounded work (DB read + filesystem write); a wall-clock cap
// is appropriate. Agent is a streaming workload so we use an idle
// timeout instead — reset on every event from agent.js.
const DEFAULT_SYNC_TIMEOUT_MS = 120_000;
const DEFAULT_AGENT_IDLE_TIMEOUT_MS = 120_000;
const getSyncTimeoutMs = () =>
	Number(process.env.SANDBOX_SYNC_TIMEOUT_MS ?? DEFAULT_SYNC_TIMEOUT_MS);
const getAgentIdleTimeoutMs = () =>
	Number(
		process.env.SANDBOX_AGENT_IDLE_TIMEOUT_MS ?? DEFAULT_AGENT_IDLE_TIMEOUT_MS,
	);

function narrowAgentEvent(raw: Record<string, unknown>): AgentEvent | null {
	switch (raw.type) {
		case "text_delta":
			if (typeof raw.text === "string") return { type: "text_delta", text: raw.text };
			return null;
		case "session_id":
			if (typeof raw.sessionId === "string")
				return { type: "session_id", sessionId: raw.sessionId };
			return null;
		case "completed":
			return { type: "completed" };
		case "failed":
			if (typeof raw.message === "string")
				return { type: "failed", message: raw.message };
			return null;
		default:
			return null;
	}
}

async function* readNdjson(
	stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>, void, void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buf = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			let nl = buf.indexOf("\n");
			while (nl !== -1) {
				const line = buf.slice(0, nl).trim();
				buf = buf.slice(nl + 1);
				if (line) {
					try {
						const parsed = JSON.parse(line);
						if (typeof parsed === "object" && parsed !== null) {
							yield parsed as Record<string, unknown>;
						}
					} catch {
						// Non-JSON line — ignore (e.g. stray stderr leaking via stdout)
					}
				}
				nl = buf.indexOf("\n");
			}
		}
		if (buf.trim()) {
			try {
				const parsed = JSON.parse(buf.trim());
				if (typeof parsed === "object" && parsed !== null) {
					yield parsed as Record<string, unknown>;
				}
			} catch {}
		}
	} finally {
		reader.releaseLock();
	}
}

async function drainStderr(stream: ReadableStream<Uint8Array>): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const text = decoder.decode(value, { stream: true });
			if (text.trim()) process.stderr.write(text);
		}
	} finally {
		reader.releaseLock();
	}
}

export async function spawnSync(input: {
	userId: string;
}): Promise<SyncResult> {
	const timeoutMs = getSyncTimeoutMs();
	const proc = Bun.spawn(
		[getBunExecutable(), getSyncBundlePath(), "--user-id", input.userId],
		{
			env: {
				DATABASE_URL: process.env.DATABASE_URL ?? "",
				PATH: process.env.PATH ?? "",
			},
			stdout: "pipe",
			stderr: "pipe",
			stdin: "ignore",
		},
	);

	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		proc.kill("SIGKILL");
	}, timeoutMs);

	try {
		const stderrPromise = drainStderr(proc.stderr);
		let terminal: SyncEvent | null = null;
		for await (const event of readNdjson(proc.stdout)) {
			if (
				event.type === "synced" &&
				typeof event.changed === "boolean" &&
				typeof event.dataRoot === "string"
			) {
				terminal = {
					type: "synced",
					changed: event.changed,
					dataRoot: event.dataRoot,
				};
			} else if (event.type === "failed" && typeof event.message === "string") {
				terminal = { type: "failed", message: event.message };
			}
		}
		await stderrPromise;
		const exitCode = await proc.exited;

		if (timedOut) {
			return {
				type: "failed",
				message: `sync timed out after ${timeoutMs}ms`,
			};
		}
		if (terminal) return terminal;
		return {
			type: "failed",
			message: `sync exited with code ${exitCode} without emitting a terminal event`,
		};
	} finally {
		clearTimeout(timer);
	}
}

export interface SpawnAgentInput {
	userQuery: string;
	systemPrompt: string;
	cwd: string;
	sessionId?: string;
	onEvent: (event: AgentEvent) => void | Promise<void>;
}

export interface SpawnAgentResult {
	exitCode: number;
}

export async function spawnAgent(
	input: SpawnAgentInput,
): Promise<SpawnAgentResult> {
	const { onEvent, ...config } = input;
	const idleMs = getAgentIdleTimeoutMs();
	const proc = Bun.spawn([getBunExecutable(), getAgentBundlePath()], {
		env: {
			ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
			PATH: process.env.PATH ?? "",
			CLAUDE_CODE_PATH: process.env.CLAUDE_CODE_PATH ?? "/usr/local/bin/claude",
		},
		stdout: "pipe",
		stderr: "pipe",
		stdin: "pipe",
	});

	proc.stdin.write(JSON.stringify(config));
	await proc.stdin.end();

	let timedOut = false;
	let idleTimer: ReturnType<typeof setTimeout>;
	const armIdleTimer = () => {
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			timedOut = true;
			proc.kill("SIGKILL");
		}, idleMs);
	};
	armIdleTimer();

	try {
		const stderrPromise = drainStderr(proc.stderr);
		for await (const event of readNdjson(proc.stdout)) {
			armIdleTimer();
			const narrowed = narrowAgentEvent(event);
			if (narrowed) await onEvent(narrowed);
		}
		await stderrPromise;
		const exitCode = await proc.exited;

		if (timedOut) {
			await onEvent({
				type: "failed",
				message: `agent idle timeout: no events for ${idleMs}ms`,
			});
		}
		return { exitCode };
	} finally {
		clearTimeout(idleTimer);
	}
}
