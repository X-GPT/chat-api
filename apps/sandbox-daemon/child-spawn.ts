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

const SYNC_BUNDLE_PATH = process.env.SANDBOX_SYNC_PATH ?? "/workspace/sync.js";
const AGENT_BUNDLE_PATH =
	process.env.SANDBOX_AGENT_PATH ?? "/workspace/agent.js";
const BUN_EXECUTABLE = process.env.SANDBOX_BUN_PATH ?? "bun";
const BWRAP_EXECUTABLE = process.env.SANDBOX_BWRAP_PATH ?? "bwrap";

/**
 * Build the argv for the bwrap-wrapped agent process. Extracted as a pure
 * helper so the flag set is easy to inspect and unit-test.
 *
 * The agent gets:
 *   - read-only view of the full root filesystem (so node_modules, the bun
 *     binary, the claude executable, /etc/ssl, etc. are all reachable);
 *   - read-write access to its scope cwd only;
 *   - a fresh tmpfs at /tmp;
 *   - private /proc and /dev (no daemon process visibility);
 *   - private user, pid, uts, ipc namespaces;
 *   - inherited network namespace — the SDK calls api.anthropic.com over
 *     HTTPS, so we cannot --unshare-net.
 *   - --die-with-parent so a daemon crash takes bwrap + the agent with it.
 */
export function buildAgentSpawnArgv(cwd: string): string[] {
	return [
		BWRAP_EXECUTABLE,
		"--ro-bind",
		"/",
		"/",
		"--bind",
		cwd,
		cwd,
		"--tmpfs",
		"/tmp",
		"--proc",
		"/proc",
		"--dev",
		"/dev",
		"--unshare-user",
		"--unshare-pid",
		"--unshare-uts",
		"--unshare-ipc",
		"--die-with-parent",
		"--",
		BUN_EXECUTABLE,
		AGENT_BUNDLE_PATH,
	];
}

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
	const proc = Bun.spawn(
		[BUN_EXECUTABLE, SYNC_BUNDLE_PATH, "--user-id", input.userId],
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

	if (terminal) return terminal;
	return {
		type: "failed",
		message: `sync exited with code ${exitCode} without emitting a terminal event`,
	};
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
	const proc = Bun.spawn(buildAgentSpawnArgv(config.cwd), {
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

	const stderrPromise = drainStderr(proc.stderr);
	for await (const event of readNdjson(proc.stdout)) {
		const narrowed = narrowAgentEvent(event);
		if (narrowed) await onEvent(narrowed);
	}
	await stderrPromise;
	const exitCode = await proc.exited;
	return { exitCode };
}
