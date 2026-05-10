import { readFileSync } from "node:fs";
import type { ModelMessage } from "ai";
import { getAllowedTools, type getTools } from "../tools/tools";

const SYSTEM_PROMPT_URL = new URL("./system-prompt.md", import.meta.url);
const SINGLE_FILE_PROMPT_URL = new URL(
	"./single-file-prompt.md",
	import.meta.url,
);
const NO_KNOWLEDGE_PROMPT_URL = new URL(
	"./no-knowledge-prompt.md",
	import.meta.url,
);

let cachedSystemPrompt: string | null = null;
let cachedSingleFilePrompt: string | null = null;
let cachedNoKnowledgePrompt: string | null = null;

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

export function getNoKnowledgePrompt(): string {
	if (cachedNoKnowledgePrompt) {
		return cachedNoKnowledgePrompt;
	}

	const rawPrompt = readFileSync(NO_KNOWLEDGE_PROMPT_URL, "utf8");
	cachedNoKnowledgePrompt = rawPrompt.trim();

	return cachedNoKnowledgePrompt;
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
