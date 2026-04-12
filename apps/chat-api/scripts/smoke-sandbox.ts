/**
 * Smoke test for runSandboxChat.
 *
 * Exercises the sandbox orchestration path end-to-end against whatever
 * DATABASE_URL and E2B credentials are in apps/chat-api/.env. Skips the
 * protected service entirely — no X-Member-Auth needed, no writes to
 * prod chat history.
 *
 * Usage:
 *   bun run scripts/smoke-sandbox.ts <userId> [query]
 *
 * Example:
 *   bun run scripts/smoke-sandbox.ts staging-user-123 "what files do I have?"
 */

import type { PinoLogger } from "hono-pino";
import pino from "pino";
import "@/config/env";
import { closeDb } from "@/db/client";
import { ChatLogger } from "@/features/chat/chat.logger";
import { runSandboxChat } from "@/features/sandbox-orchestration";

const userId = process.argv[2];
const query = process.argv[3] ?? "list the files in your working directory";

if (!userId) {
	console.error("usage: bun run scripts/smoke-sandbox.ts <userId> [query]");
	process.exit(1);
}

const chatKey = `smoke-${Date.now()}`;
const pinoLogger = pino({ level: "debug" }) as unknown as PinoLogger;
const logger = new ChatLogger(pinoLogger, userId, chatKey);

async function main() {
	console.log(`\n=== runSandboxChat smoke test ===`);
	console.log(`userId:  ${userId}`);
	console.log(`chatKey: ${chatKey}`);
	console.log(`query:   ${query}\n`);

	const start = performance.now();

	await runSandboxChat({
		userId,
		query,
		scope: "general",
		collectionId: null,
		summaryId: null,
		chatKey,
		onTextDelta: (text) => process.stdout.write(text),
		onTextEnd: async () => {
			const elapsed = (performance.now() - start) / 1000;
			process.stdout.write(`\n\n[done in ${elapsed.toFixed(1)}s]\n`);
		},
		logger,
	});
}

try {
	await main();
	process.exitCode = 0;
} catch (err) {
	console.error("\n✗ smoke test failed:", err);
	process.exitCode = 1;
} finally {
	await closeDb();
}
