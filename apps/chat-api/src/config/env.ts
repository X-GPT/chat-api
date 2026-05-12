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
	invariant(Bun.env.DAEMON_AUTH_SECRET, "DAEMON_AUTH_SECRET is required");

	return {
		DATABASE_URL: Bun.env.DATABASE_URL,
		OPENAI_API_KEY: Bun.env.OPENAI_API_KEY,
		ANTHROPIC_API_KEY: Bun.env.ANTHROPIC_API_KEY,
		DEEPSEEK_API_KEY: Bun.env.DEEPSEEK_API_KEY,
		DAEMON_AUTH_SECRET: Bun.env.DAEMON_AUTH_SECRET,
		DEEPSEEK_BASE_URL: Bun.env.DEEPSEEK_BASE_URL || null,
		DEEPSEEK_DEFAULT_MODEL:
			Bun.env.DEEPSEEK_DEFAULT_MODEL || DEFAULT_DEEPSEEK_MODEL,
		LOG_LEVEL: Bun.env.LOG_LEVEL || "info",
		E2B_TEMPLATE: Bun.env.E2B_TEMPLATE || "sandbox-template-dev",
	} as const;
})();

export type ChatMessagesScope = "general" | "collection" | "document";
