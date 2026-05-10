import invariant from "tiny-invariant";

const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

/**
 * Environment variables for the API server
 * All variables are validated at module load time
 */
export const apiEnv = (() => {
	invariant(Bun.env.OPENAI_API_KEY, "OPENAI_API_KEY is required");
	invariant(Bun.env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY is required");
	invariant(Bun.env.DEEPSEEK_API_KEY, "DEEPSEEK_API_KEY is required");
	invariant(Bun.env.E2B_API_KEY, "E2B_API_KEY is required");
	invariant(Bun.env.DATABASE_URL, "DATABASE_URL is required");

	return {
		DATABASE_URL: Bun.env.DATABASE_URL,
		OPENAI_API_KEY: Bun.env.OPENAI_API_KEY,
		ANTHROPIC_API_KEY: Bun.env.ANTHROPIC_API_KEY,
		DEEPSEEK_API_KEY: Bun.env.DEEPSEEK_API_KEY,
		DEEPSEEK_BASE_URL: Bun.env.DEEPSEEK_BASE_URL || null,
		DEEPSEEK_DEFAULT_MODEL:
			Bun.env.DEEPSEEK_DEFAULT_MODEL || DEFAULT_DEEPSEEK_MODEL,
		// Optional env vars that route the Claude Code CLI (running inside the
		// sandbox daemon) to an alternate Anthropic-compatible backend such as
		// DeepSeek. When set, they are forwarded to the daemon process and
		// inherited by the claude CLI subprocess. Pure passthrough — no JS code
		// reads them; the SDK/CLI picks them up from process.env.
		ANTHROPIC_BASE_URL: Bun.env.ANTHROPIC_BASE_URL || null,
		ANTHROPIC_AUTH_TOKEN: Bun.env.ANTHROPIC_AUTH_TOKEN || null,
		ANTHROPIC_MODEL: Bun.env.ANTHROPIC_MODEL || null,
		ANTHROPIC_DEFAULT_OPUS_MODEL: Bun.env.ANTHROPIC_DEFAULT_OPUS_MODEL || null,
		ANTHROPIC_DEFAULT_SONNET_MODEL:
			Bun.env.ANTHROPIC_DEFAULT_SONNET_MODEL || null,
		ANTHROPIC_DEFAULT_HAIKU_MODEL:
			Bun.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || null,
		CLAUDE_CODE_SUBAGENT_MODEL: Bun.env.CLAUDE_CODE_SUBAGENT_MODEL || null,
		CLAUDE_CODE_EFFORT_LEVEL: Bun.env.CLAUDE_CODE_EFFORT_LEVEL || null,
		LOG_LEVEL: Bun.env.LOG_LEVEL || "info",
		E2B_TEMPLATE: Bun.env.E2B_TEMPLATE || "sandbox-template-dev",
	} as const;
})();

export type ChatMessagesScope = "general" | "collection" | "document";
