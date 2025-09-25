import { readFileSync } from "node:fs";
import type { ModelMessage } from "ai";
import type { LanguageModelProvider } from "../chat.language-models";
import { readFileTool } from "../tools/read-file";
import { updatePlanTool } from "../tools/update-plan";

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
	provider,
	systemPrompt,
	environmentContext,
	messages,
}: {
	provider: LanguageModelProvider;
	systemPrompt: string;
	environmentContext: string | null;
	messages: ModelMessage[];
}) {
	const tools = {
		"update-plan": updatePlanTool,
		"read-file": readFileTool,
	};

	if (provider === "openai") {
		return {
			system: systemPrompt,
			tools,
			messages,
		};
	}

	return {
		system: `${systemPrompt}\n\n${environmentContext ?? ""}`,
		tools,
		messages,
	};
}
