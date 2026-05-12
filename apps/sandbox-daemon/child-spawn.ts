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

const SYNC_BUNDLE_PATH = process.env.SANDBOX_SYNC_PATH ?? "/workspace/sync.js";
const AGENT_BUNDLE_PATH =
	process.env.SANDBOX_AGENT_PATH ?? "/workspace/agent.js";
const BUN_EXECUTABLE = process.env.SANDBOX_BUN_PATH ?? "bun";

export type SyncResult =
	| { type: "synced"; changed: boolean; dataRoot: string }
	| { type: "failed"; message: string };

export type AgentEvent =
	| { type: "text_delta"; text: string }
	| { type: "session_id"; sessionId: string }
	| { type: "completed" }
	| { type: "failed"; message: string };

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
	let terminal: SyncResult | null = null;
	for await (const event of readNdjson(proc.stdout)) {
		if (event.type === "synced") {
			terminal = {
				type: "synced",
				changed: event.changed === true,
				dataRoot: typeof event.dataRoot === "string" ? event.dataRoot : "",
			};
		} else if (event.type === "failed") {
			terminal = {
				type: "failed",
				message:
					typeof event.message === "string" ? event.message : "sync failed",
			};
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
	const proc = Bun.spawn([BUN_EXECUTABLE, AGENT_BUNDLE_PATH], {
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
		if (
			event.type === "text_delta" ||
			event.type === "session_id" ||
			event.type === "completed" ||
			event.type === "failed"
		) {
			await onEvent(event as AgentEvent);
		}
	}
	await stderrPromise;
	const exitCode = await proc.exited;
	return { exitCode };
}
