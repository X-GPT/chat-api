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

function hasSessionId(
	msg: Record<string, unknown>,
): msg is Record<string, unknown> & { session_id: string } {
	return typeof msg.session_id === "string";
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
	};

	if (sessionId) {
		queryOptions.resume = sessionId;
	}

	const result = query({
		prompt: userQuery,
		options: queryOptions,
	});

	let emittedSessionId = false;

	for await (const msg of result) {
		const m = msg as Record<string, unknown>;

		if (!emittedSessionId && hasSessionId(m)) {
			callbacks.onSessionId(m.session_id);
			emittedSessionId = true;
		}

		if (m.type === "stream_event") {
			const event = m.event as Record<string, unknown> | undefined;
			const delta = event?.delta as Record<string, unknown> | undefined;
			if (
				event?.type === "content_block_delta" &&
				delta?.type === "text_delta" &&
				typeof delta?.text === "string"
			) {
				callbacks.onTextDelta(delta.text);
			}
		} else if (m.type === "result") {
			if (!emittedSessionId && hasSessionId(m)) {
				callbacks.onSessionId(m.session_id);
				emittedSessionId = true;
			}

			if (m.subtype === "success") {
				callbacks.onCompleted();
			} else {
				callbacks.onFailed(`Agent ended with: ${m.subtype}`);
			}
		}
	}
}
