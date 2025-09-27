import { readFileSync } from "node:fs";
import type { ModelMessage } from "ai";
import type { ChatMessagesScope } from "@/config/env";
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
	environmentContext,
	tools,
	scope,
	messages,
}: {
	systemPrompt: string;
	environmentContext: string | null;
	tools: ReturnType<typeof getTools>;
	scope: ChatMessagesScope;
	messages: ModelMessage[];
}) {
	const allowedTools = getAllowedTools(scope);

	return {
		system: `${systemPrompt}\n\n${environmentContext ?? ""}`,
		tools,
		messages,
		allowedTools,
	};
}
