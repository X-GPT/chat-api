import invariant from "tiny-invariant";

function parsePort(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const n = Number(value);
	invariant(
		Number.isInteger(n) && n > 0 && n < 65536,
		`DOCUMENT_GATEWAY_PORT must be an integer in 1..65535, got: ${value}`,
	);
	return n;
}

/**
 * Environment for the document gateway. This is the only service that holds the
 * real MyMemo document-API credential — keep its surface tiny. Validated at
 * module load.
 *
 * Uses a dedicated DOCUMENT_GATEWAY_PORT (not the generic PORT) so it never
 * collides with another co-located service reading the same injected env.
 */
export const gwEnv = (() => {
	invariant(Bun.env.LLM_TOKEN_SECRET, "LLM_TOKEN_SECRET is required");
	invariant(Bun.env.MYMEMO_DOC_API_URL, "MYMEMO_DOC_API_URL is required");
	invariant(Bun.env.MYMEMO_DOC_API_KEY, "MYMEMO_DOC_API_KEY is required");

	return {
		// Shared with chat-api (which mints the per-turn token) so we can verify it.
		LLM_TOKEN_SECRET: Bun.env.LLM_TOKEN_SECRET,
		// Base URL of the real MyMemo document API. Trailing slash stripped so
		// `${base}${path}` never yields a double slash.
		MYMEMO_DOC_API_URL: Bun.env.MYMEMO_DOC_API_URL.replace(/\/+$/, ""),
		// The real document-API credential — lives ONLY in this service.
		MYMEMO_DOC_API_KEY: Bun.env.MYMEMO_DOC_API_KEY,
		DOCUMENT_GATEWAY_PORT: parsePort(Bun.env.DOCUMENT_GATEWAY_PORT, 8082),
	} as const;
})();
