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

	const sandboxEnabled = Bun.env.SANDBOX_ENABLED === "true";
	if (sandboxEnabled) {
		invariant(
			Bun.env.E2B_API_KEY,
			"E2B_API_KEY is required when SANDBOX_ENABLED=true",
		);
		invariant(
			Bun.env.DATABASE_URL,
			"DATABASE_URL is required when SANDBOX_ENABLED=true",
		);
	}

	const databaseUrl = Bun.env.DATABASE_URL || null;

	return {
		SANDBOX_ENABLED: sandboxEnabled,
		DATABASE_URL: databaseUrl,
		OPENAI_API_KEY: Bun.env.OPENAI_API_KEY,
		ANTHROPIC_API_KEY: Bun.env.ANTHROPIC_API_KEY,
		DEEPSEEK_API_KEY: Bun.env.DEEPSEEK_API_KEY,
		DEEPSEEK_BASE_URL: Bun.env.DEEPSEEK_BASE_URL || null,
		DEEPSEEK_DEFAULT_MODEL:
			Bun.env.DEEPSEEK_DEFAULT_MODEL || DEFAULT_DEEPSEEK_MODEL,
		LOG_LEVEL: Bun.env.LOG_LEVEL || "info",
		E2B_TEMPLATE: Bun.env.E2B_TEMPLATE || "sandbox-template-dev",
	} as const;
})();

export function isSandboxEnabled(): boolean {
	return apiEnv.SANDBOX_ENABLED;
}

export type ChatMessagesScope = "general" | "collection" | "document";
