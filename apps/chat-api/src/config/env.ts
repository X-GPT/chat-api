import invariant from "tiny-invariant";

/**
 * Environment variables for the API server
 * All variables are validated at module load time
 */
export const apiEnv = (() => {
	invariant(Bun.env.E2B_API_KEY, "E2B_API_KEY is required");
	invariant(Bun.env.DATABASE_URL, "DATABASE_URL is required");
	invariant(Bun.env.DAEMON_AUTH_TOKEN, "DAEMON_AUTH_TOKEN is required");
	invariant(Bun.env.LLM_TOKEN_SECRET, "LLM_TOKEN_SECRET is required");
	invariant(
		Bun.env.LLM_GATEWAY_PUBLIC_URL,
		"LLM_GATEWAY_PUBLIC_URL is required",
	);

	return {
		DATABASE_URL: Bun.env.DATABASE_URL,
		DAEMON_AUTH_TOKEN: Bun.env.DAEMON_AUTH_TOKEN,
		// HMAC secret for the session tokens minted into each sandbox turn. Shared
		// only with llm-gateway, which verifies them.
		LLM_TOKEN_SECRET: Bun.env.LLM_TOKEN_SECRET,
		// Base URL the sandboxed agent points the Claude binary at
		// (ANTHROPIC_BASE_URL). Must be reachable from inside the E2B sandbox.
		// Trailing slash stripped so the binary's `${base}/v1/messages` never
		// produces a double slash the gateway would have to normalize.
		LLM_GATEWAY_PUBLIC_URL: Bun.env.LLM_GATEWAY_PUBLIC_URL.replace(/\/+$/, ""),
		LOG_LEVEL: Bun.env.LOG_LEVEL || "info",
		E2B_TEMPLATE: Bun.env.E2B_TEMPLATE || "sandbox-template-dev",
	} as const;
})();

export type ChatMessagesScope = "general" | "collection" | "document";
