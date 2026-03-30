/**
 * Sandbox Agent Runner
 *
 * This script runs inside an E2B sandbox. It uses the Claude Agent SDK
 * to search and read local document files, then streams an answer
 * with inline citations back to the host via NDJSON on stdout.
 *
 * Usage: node agent-runner.mjs request.json
 *
 * Input JSON: { query, systemPrompt, cwd, sessionId? }
 * Output: NDJSON lines to stdout
 *   {"type":"text_delta","text":"..."}
 *   {"type":"result","text":"<full accumulated text>"}
 *   {"type":"session_id","sessionId":"..."}
 *   {"type":"error","message":"..."}
 */

import { readFileSync } from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";

/** Write a single NDJSON event to stdout */
function emit(event) {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function main() {
	const requestPath = process.argv[2];
	if (!requestPath) {
		emit({
			type: "error",
			message: "Usage: node agent-runner.mjs <request.json>",
		});
		process.exit(1);
	}

	let input;
	try {
		input = JSON.parse(readFileSync(requestPath, "utf-8"));
	} catch (err) {
		emit({
			type: "error",
			message: `Failed to read request file: ${err.message}`,
		});
		process.exit(1);
	}

	const { query: userQuery, systemPrompt, cwd, sessionId } = input;

	if (!userQuery || !systemPrompt || !cwd) {
		emit({
			type: "error",
			message: "Request must include query, systemPrompt, and cwd",
		});
		process.exit(1);
	}

	let accumulatedText = "";

	try {
		const queryOptions = {
			cwd,
			systemPrompt,
			allowedTools: ["Bash", "Read", "Grep", "Glob"],
			permissionMode: "bypassPermissions",
			includePartialMessages: true,
			model: "claude-sonnet-4-6",
		};

		// If resuming a previous session, pass the session ID
		if (sessionId) {
			queryOptions.resume = sessionId;
		}

		const result = query({
			prompt: userQuery,
			options: queryOptions,
		});

		let emittedSessionId = false;

		for await (const msg of result) {
			// Capture session ID from any message that carries it
			if (!emittedSessionId && msg.session_id) {
				emit({ type: "session_id", sessionId: msg.session_id });
				emittedSessionId = true;
			}

			if (msg.type === "stream_event") {
				const event = msg.event;
				if (
					event.type === "content_block_delta" &&
					event.delta.type === "text_delta"
				) {
					const text = event.delta.text;
					accumulatedText += text;
					emit({ type: "text_delta", text });
				}
			} else if (msg.type === "result") {
				// Capture session ID from result if not already emitted
				if (!emittedSessionId && msg.session_id) {
					emit({ type: "session_id", sessionId: msg.session_id });
					emittedSessionId = true;
				}

				if (msg.subtype === "success") {
					emit({ type: "result", text: msg.result || accumulatedText });
				} else {
					emit({
						type: "error",
						message: `Agent ended with: ${msg.subtype}`,
					});
				}
			}
		}
	} catch (err) {
		emit({ type: "error", message: `Agent error: ${err.message}` });
		process.exit(1);
	}
}

main();
