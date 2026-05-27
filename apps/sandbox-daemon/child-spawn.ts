/**
 * Spawn helpers for the per-turn sync.js and agent.js children. The daemon
 * holds DATABASE_URL in its env so it can forward it to sync.js, but never
 * imports the DB driver or the Claude Agent SDK itself — those live exclusively
 * in sync.js / agent.js. The agent's LLM credentials are not provider keys: it
 * gets a gateway base URL + short-lived bearer token, supplied per turn.
 *
 * Both children speak NDJSON on stdout. We line-buffer, parse, and dispatch.
 *
 * Bundle paths are env-overridable for tests; in production sandboxes the
 * chat-api writes the three bundles to /workspace/{daemon,sync,agent}.js.
 */

import { mkdirSync } from "node:fs";
import type { AgentEvent, SyncEvent } from "./ipc-protocol";

export type { AgentEvent, SyncEvent } from "./ipc-protocol";
export type SyncResult = SyncEvent;

function getSyncBundlePath(): string {
	return process.env.SANDBOX_SYNC_PATH ?? "/workspace/sync.js";
}
function getAgentBundlePath(): string {
	return process.env.SANDBOX_AGENT_PATH ?? "/workspace/agent.js";
}
function getBunExecutable(): string {
	return process.env.SANDBOX_BUN_PATH ?? "bun";
}
function getBwrapExecutable(): string {
	return process.env.SANDBOX_BWRAP_PATH ?? "bwrap";
}

// Must match the sandbox template's setWorkdir (apps/chat-api/sandbox-template/
// template.ts) and the path the chat-api writes bundles into
// (apps/chat-api/src/features/sandbox-orchestration/sandbox-manager.ts).
// Changing it requires updating all three.
const WORKSPACE_ROOT = "/workspace";

// The Claude Agent SDK persists session transcripts to
// ~/.claude/projects/ by default. With --ro-bind / / that directory is
// read-only inside bwrap, which breaks both the first-turn write and any
// `resume: sessionId` on later turns. Re-bind just this subtree as rw.
// Confined to the specific directory the SDK writes to so the rest of
// ~/.claude (settings, auth state) stays read-only.
function getClaudeProjectsDir(): string {
	const home = Bun.env.HOME ?? "/home/user";
	return `${home}/.claude/projects`;
}

/**
 * Build the argv for the bwrap-wrapped agent process. Extracted as a pure
 * helper so the flag set is easy to inspect and unit-test.
 *
 * Filesystem layout:
 *   1. --ro-bind / /                       — system libs, bun, claude,
 *                                             /etc/ssl, /home/user/.claude.
 *                                             Read-only.
 *   2. --tmpfs /workspace                  — mask the daemon's working
 *                                             directory entirely. Hides
 *                                             daemon.log (which accumulates
 *                                             stderr across turns),
 *                                             daemon.js, sync.js, and every
 *                                             user's data tree.
 *   3. --ro-bind /workspace/agent.js ...   — re-expose only the agent bundle
 *                                             so bun can load it.
 *   4. --bind <cwd> <cwd>                  — re-expose only the selected
 *                                             scope as read-write. For
 *                                             collection/document scopes
 *                                             this is a subdir; for global
 *                                             scope it's the canonical tree.
 *                                             Hardlinks resolve via inode,
 *                                             not path, so collection scopes
 *                                             can still read their
 *                                             underlying canonical content.
 *   5. --bind ~/.claude/projects ...       — re-expose the Claude Agent SDK's
 *                                             session transcript directory
 *                                             rw so resume across turns
 *                                             works. Caller is responsible
 *                                             for ensuring the dir exists
 *                                             before spawn (see
 *                                             ensureClaudeProjectsDir).
 *   6. --tmpfs /tmp                        — fresh scratch space.
 *
 * Namespaces:
 *   - --unshare-user, --unshare-pid, --unshare-uts, --unshare-ipc.
 *   - Inherited network — the Claude SDK calls the LLM gateway over HTTPS,
 *     so we cannot --unshare-net.
 *
 * Lifetime:
 *   - --die-with-parent so a daemon crash takes bwrap + the agent with it.
 */
export function buildAgentSpawnArgv(cwd: string): string[] {
	const agentBundle = getAgentBundlePath();
	const claudeProjectsDir = getClaudeProjectsDir();
	return [
		getBwrapExecutable(),
		"--ro-bind",
		"/",
		"/",
		"--tmpfs",
		WORKSPACE_ROOT,
		"--ro-bind",
		agentBundle,
		agentBundle,
		"--bind",
		cwd,
		cwd,
		"--bind",
		claudeProjectsDir,
		claudeProjectsDir,
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
		getBunExecutable(),
		agentBundle,
	];
}

/**
 * Pre-create ~/.claude/projects so the bwrap --bind has something to mount.
 * Idempotent. Must be called before spawnAgent on every turn — bwrap fails
 * if the source path doesn't exist, and the SDK can't create it itself
 * (the rest of ~/.claude is read-only inside the sandbox).
 */
function ensureClaudeProjectsDir(): void {
	mkdirSync(getClaudeProjectsDir(), { recursive: true });
}

function narrowAgentEvent(raw: Record<string, unknown>): AgentEvent | null {
	switch (raw.type) {
		case "text_delta":
			if (typeof raw.text === "string")
				return { type: "text_delta", text: raw.text };
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
	/** LLM gateway base URL — set as ANTHROPIC_BASE_URL for the Claude binary. */
	llmBaseUrl: string;
	/** Short-lived bearer token — set as ANTHROPIC_AUTH_TOKEN. */
	llmToken: string;
	onEvent: (event: AgentEvent) => void | Promise<void>;
}

export interface SpawnAgentResult {
	exitCode: number;
}

export async function spawnAgent(
	input: SpawnAgentInput,
): Promise<SpawnAgentResult> {
	const { onEvent, llmBaseUrl, llmToken, ...config } = input;
	ensureClaudeProjectsDir();
	const proc = Bun.spawn(buildAgentSpawnArgv(config.cwd), {
		env: {
			// The agent holds no provider key — it talks to the LLM gateway, which
			// injects the real key. ANTHROPIC_AUTH_TOKEN is sent as a Bearer header.
			ANTHROPIC_BASE_URL: llmBaseUrl,
			ANTHROPIC_AUTH_TOKEN: llmToken,
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
