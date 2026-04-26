/**
 * Builds a system-prompt identity directive for Claude-family model requests.
 *
 * The chat-api routes claude-* requests through DeepSeek under the hood
 * (see chat.language-models.ts). This helper produces a directive instructing
 * the underlying model to identify itself as Claude regardless of the actual
 * backend, so user-facing identity matches what callers requested.
 *
 * Returns null for non-Claude requests (gpt-*, gemini-*, etc.) so those
 * providers can answer with their natural identity.
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
