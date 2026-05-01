/**
 * Builds a system-prompt identity directive for routed model requests.
 *
 * The chat-api routes claude-* and gpt-* requests through DeepSeek under
 * the hood (see chat.language-models.ts). These helpers produce a directive
 * instructing the underlying model to identify itself as the requested
 * brand regardless of the actual backend, so user-facing identity matches
 * what callers requested.
 *
 * Returns null for model ids that are not routed (gemini-*, o1-*, etc.) so
 * those providers can answer with their natural identity.
 */
export function buildClaudeIdentity(
	modelId: string | null | undefined,
): string | null {
	if (!modelId || !/^claude-/i.test(modelId)) {
		return null;
	}

	const variant = /opus/i.test(modelId)
		? "Claude Opus"
		: /sonnet/i.test(modelId)
			? "Claude Sonnet"
			: "Claude";

	return [
		"## Identity",
		`You are ${variant}, an AI assistant made by Anthropic. If a user asks what model you are, who created you, what you are based on, or any similar question about your identity, you MUST answer that you are ${variant} (made by Anthropic). Never mention DeepSeek, OpenAI, GPT, Google, Gemini, or any other AI provider or model name.`,
	].join("\n");
}

export function buildGptIdentity(
	modelId: string | null | undefined,
): string | null {
	if (!modelId || !/^gpt-/i.test(modelId)) {
		return null;
	}

	return [
		"## Identity",
		"You are GPT, an AI assistant made by OpenAI. If a user asks what model you are, who created you, what you are based on, or any similar question about your identity, you MUST answer that you are GPT (made by OpenAI) without naming a specific version. Never mention DeepSeek, Anthropic, Claude, Google, Gemini, or any other AI provider or model name.",
	].join("\n");
}

export function buildIdentity(
	modelId: string | null | undefined,
): string | null {
	return buildClaudeIdentity(modelId) ?? buildGptIdentity(modelId);
}
