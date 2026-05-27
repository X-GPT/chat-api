import invariant from "tiny-invariant";

function parsePort(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const n = Number(value);
	invariant(
		Number.isInteger(n) && n > 0 && n < 65536,
		`GATEWAY_PORT must be an integer in 1..65535, got: ${value}`,
	);
	return n;
}

/**
 * Environment for the LLM gateway. This is the only service that holds the real
 * provider key — keep its surface tiny. Validated at module load.
 *
 * Uses a dedicated GATEWAY_PORT rather than the generic PORT so it never
 * collides with another service's PORT when both read the same injected env.
 */
export const gwEnv = (() => {
	invariant(Bun.env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY is required");
	invariant(Bun.env.LLM_TOKEN_SECRET, "LLM_TOKEN_SECRET is required");

	return {
		ANTHROPIC_API_KEY: Bun.env.ANTHROPIC_API_KEY,
		LLM_TOKEN_SECRET: Bun.env.LLM_TOKEN_SECRET,
		// Trailing slash stripped so `${base}${path}` never yields a double slash.
		UPSTREAM_BASE_URL: (
			Bun.env.UPSTREAM_BASE_URL || "https://api.anthropic.com"
		).replace(/\/+$/, ""),
		GATEWAY_PORT: parsePort(Bun.env.GATEWAY_PORT, 8081),
	} as const;
})();
