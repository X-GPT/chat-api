// Set required env vars before any module evaluation.
// This runs as a Bun test preload so env.ts IIFE won't crash.
Bun.env.OPENAI_API_KEY = Bun.env.OPENAI_API_KEY ?? "test-openai-key";
Bun.env.ANTHROPIC_API_KEY = Bun.env.ANTHROPIC_API_KEY ?? "test-anthropic-key";
Bun.env.DEEPSEEK_API_KEY = Bun.env.DEEPSEEK_API_KEY ?? "test-deepseek-key";
Bun.env.E2B_API_KEY = Bun.env.E2B_API_KEY ?? "test-e2b-key";
Bun.env.DAEMON_AUTH_SECRET =
	Bun.env.DAEMON_AUTH_SECRET ?? "test-daemon-auth-secret";
Bun.env.DATABASE_URL =
	Bun.env.DATABASE_URL ?? "postgres://test:test@localhost:5432/test";
