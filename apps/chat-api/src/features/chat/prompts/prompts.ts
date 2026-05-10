import { readFileSync } from "node:fs";
import type { ModelMessage } from "ai";
import { getAllowedTools, type getTools } from "../tools/tools";

const SYSTEM_PROMPT_URL = new URL("./system-prompt.md", import.meta.url);

let cachedSystemPrompt: string | null = null;

export function getSystemPrompt(): string {
	if (cachedSystemPrompt) {
		return cachedSystemPrompt;
	}

	const rawPrompt = readFileSync(SYSTEM_PROMPT_URL, "utf8");
	cachedSystemPrompt = rawPrompt.trim();

	return cachedSystemPrompt;
}

export function buildPrompt({
	systemPrompt,
	identity,
	tools,
	messages,
}: {
	systemPrompt: string;
	identity?: string | null;
	tools: ReturnType<typeof getTools>;
	messages: ModelMessage[];
}) {
	const identityPrefix = identity ? `${identity}\n\n` : "";
	return {
		system: `${identityPrefix}${systemPrompt}`,
		tools,
		messages,
		allowedTools: getAllowedTools(),
	};
}
