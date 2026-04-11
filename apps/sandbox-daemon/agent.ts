/**
 * Claude Agent SDK wrapper for running agent queries inside the sandbox.
 * Ported from agent-runner.mjs to TypeScript, adapted for daemon use.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

export interface AgentRunOptions {
	userQuery: string;
	systemPrompt: string;
	cwd: string;
	sessionId?: string;
}

export interface AgentCallbacks {
	onTextDelta: (text: string) => void | Promise<void>;
	onSessionId: (sessionId: string) => void | Promise<void>;
	onCompleted: () => void | Promise<void>;
	onFailed: (message: string) => void | Promise<void>;
}

/**
 * Run a Claude Agent SDK query and stream results through callbacks.
 */
export async function runAgent(
	options: AgentRunOptions,
	callbacks: AgentCallbacks,
): Promise<void> {
	const { userQuery, systemPrompt, cwd, sessionId } = options;

	const queryOptions: Record<string, unknown> = {
		cwd,
		systemPrompt,
		allowedTools: ["Bash", "Read", "Grep", "Glob"],
		permissionMode: "bypassPermissions",
		includePartialMessages: true,
		model: "claude-sonnet-4-6",
		pathToClaudeCodeExecutable:
			process.env.CLAUDE_CODE_PATH ?? "/usr/local/bin/claude",
	};

	if (sessionId) {
		queryOptions.resume = sessionId;
	}

	let result: ReturnType<typeof query>;
	try {
		result = query({
			prompt: userQuery,
			options: queryOptions,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await callbacks.onFailed(`Agent SDK query() failed: ${message}`);
		return;
	}

	let emittedSessionId = false;

	try {
		for await (const msg of result) {
			if (!emittedSessionId && msg.type === "stream_event") {
				await callbacks.onSessionId(msg.session_id);
				emittedSessionId = true;
			}

			if (msg.type === "stream_event") {
				const event = msg.event;

				if (event.type === "content_block_delta") {
					const delta = event.delta;
					if (delta.type === "text_delta") {
						await callbacks.onTextDelta(delta.text);
					}
				}
			} else if (msg.type === "result") {
				if (!emittedSessionId) {
					await callbacks.onSessionId(msg.session_id);
					emittedSessionId = true;
				}

				if (msg.subtype === "success") {
					await callbacks.onCompleted();
				} else {
					await callbacks.onFailed(`Agent ended with: ${msg.subtype}`);
				}
			}
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await callbacks.onFailed(`Agent stream error: ${message}`);
	}
}
