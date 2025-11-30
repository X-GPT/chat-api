import { readFileSync } from "node:fs";
import type { ModelMessage } from "ai";
import type { ChatMessagesScope } from "@/config/env";
import { getAllowedTools, type getTools } from "../tools/tools";

const SYSTEM_PROMPT_URL = new URL("./system-prompt.md", import.meta.url);
const SINGLE_FILE_PROMPT_URL = new URL(
	"./single-file-prompt.md",
	import.meta.url,
);

let cachedSystemPrompt: string | null = null;
let cachedSingleFilePrompt: string | null = null;

export function getSystemPrompt(): string {
	if (cachedSystemPrompt) {
		return cachedSystemPrompt;
	}

	const rawPrompt = readFileSync(SYSTEM_PROMPT_URL, "utf8");
	cachedSystemPrompt = rawPrompt.trim();

	return cachedSystemPrompt;
}

export function getSingleFilePrompt(): string {
	if (cachedSingleFilePrompt) {
		return cachedSingleFilePrompt;
	}

	const rawPrompt = readFileSync(SINGLE_FILE_PROMPT_URL, "utf8");
	cachedSingleFilePrompt = rawPrompt.trim();

	return cachedSingleFilePrompt;
}

export function buildPrompt({
	systemPrompt,
	environmentContext,
	tools,
	scope,
	enableKnowledge,
	messages,
}: {
	systemPrompt: string;
	environmentContext: string | null;
	tools: ReturnType<typeof getTools>;
	scope: ChatMessagesScope;
	enableKnowledge: boolean;
	messages: ModelMessage[];
}) {
	const allowedTools = getAllowedTools(scope, enableKnowledge);

	return {
		system: `${systemPrompt}\n\n${environmentContext ?? ""}`,
		tools,
		messages,
		allowedTools,
	};
}
