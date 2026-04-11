/**
 * Probe inner script — runs inside the sandbox.
 *
 * Reads /tmp/probe-config.json for the user prompt, system prompt, and cwd.
 * Drives the Claude Agent SDK directly and logs every message as JSON so
 * the outer script can inspect tool_use / tool_result blocks.
 */

import { readFileSync } from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";

const config = JSON.parse(readFileSync("/tmp/probe-config.json", "utf-8")) as {
	userPrompt: string;
	systemPrompt: string;
	cwd: string;
};

const result = query({
	prompt: config.userPrompt,
	options: {
		cwd: config.cwd,
		systemPrompt: config.systemPrompt,
		allowedTools: ["Bash", "Read", "Grep", "Glob"],
		permissionMode: "bypassPermissions",
		includePartialMessages: false,
		model: "claude-sonnet-4-6",
		pathToClaudeCodeExecutable: "/usr/local/bin/claude",
	},
});

for await (const msg of result) {
	console.log(JSON.stringify(msg));
}
