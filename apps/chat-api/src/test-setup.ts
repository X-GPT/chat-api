// Set required env vars before any module evaluation.
// This runs as a Bun test preload so env.ts IIFE won't crash.
Bun.env.OPENAI_API_KEY = Bun.env.OPENAI_API_KEY ?? "test-openai-key";
Bun.env.ANTHROPIC_API_KEY = Bun.env.ANTHROPIC_API_KEY ?? "test-anthropic-key";
Bun.env.PROTECTED_API_TOKEN = Bun.env.PROTECTED_API_TOKEN ?? "test-token";
