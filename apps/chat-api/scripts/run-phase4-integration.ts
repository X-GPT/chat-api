/**
 * Phase 4 Integration Test: Sandbox orchestration end-to-end.
 *
 * Tests the full flow:
 *   1. Seed InMemoryDocumentRepository with test data
 *   2. Start internal sync endpoint on a local server
 *   3. Create sandbox, trigger sync via sync-runner.mjs pulling from endpoint
 *   4. Run query via sandbox agent, verify text + citations
 *   5. Run second query with session resume, verify context continuity
 *
 * Usage:
 *   E2B_TEMPLATE=sandbox-template-dev bun run scripts/run-phase4-integration.ts
 *
 * Requires:
 *   - E2B_API_KEY
 *   - ANTHROPIC_API_KEY
 */

import { serve } from "bun";
import type { ProtectedSummary } from "../src/features/chat/api/types";
import { extractReferencesFromText } from "../src/features/chat/lib/extract-citations-from-markdown";
import { computeChecksum, materializeSummary } from "../src/features/sandbox";
import {
	InMemoryDocumentRepository,
	createSyncEndpoint,
} from "../src/features/sandbox-orchestration";
import { SandboxManager } from "../src/features/sandbox-orchestration/sandbox-manager";
import { SessionStore } from "../src/features/sandbox-orchestration/session-store";
import { runSandboxAgent } from "../src/features/sandbox-agent";
import type { SyncDocument } from "../src/features/sandbox-orchestration/sync-types";

const now = () => Date.now();

/**
 * Compute checksum using the canonical materialization from Phase 2.
 * In production, this would be stored in the DB at write time.
 */
function testChecksum(doc: {
	summaryId: string;
	type: number;
	title: string | null;
	content: string | null;
	parseContent: string | null;
	fileType: string | null;
}): string {
	const summary = {
		id: doc.summaryId,
		type: doc.type,
		title: doc.title,
		content: doc.content,
		parseContent: doc.parseContent,
		fileType: doc.fileType,
	} as ProtectedSummary;
	const { content } = materializeSummary(summary, {
		workspaceRoot: "/workspace/sandbox-prototype",
		userId: "unused",
	});
	return computeChecksum(content);
}

// ─── Test Data ───────────────────────────────────────────────────────────────

const TEST_USER_ID = "test-user-phase4";
const TEST_COLLECTION_ID = "col-abc";

const rawDocs = [
	{
		summaryId: "1001",
		type: 0,
		title: "Q4 2025 Budget Report",
		content:
			"The Q4 2025 budget allocates $2.5M to engineering and $1.2M to marketing. The engineering budget includes $800K for infrastructure upgrades and $500K for new hires.",
		parseContent: null,
		fileType: null,
		collections: [TEST_COLLECTION_ID],
	},
	{
		summaryId: "1002",
		type: 0,
		title: "Project Alpha Status",
		content:
			"Project Alpha launched on March 1, 2026. The team consists of 5 engineers and 2 designers. Key milestones: MVP by April 15, Beta by June 1, GA by August 15.",
		parseContent: null,
		fileType: null,
		collections: [],
	},
	{
		summaryId: "1003",
		type: 3,
		title: "Team Meeting Notes",
		content:
			"# Meeting Notes - March 27\n\nAttendees: Alice, Bob, Charlie\n\n## Decisions\n- Approved Q4 budget\n- Project Alpha timeline confirmed\n- New hiring plan for engineering team",
		parseContent: null,
		fileType: null,
		collections: [TEST_COLLECTION_ID],
	},
] as const;

const testDocuments: SyncDocument[] = rawDocs.map((doc) => ({
	...doc,
	collections: [...doc.collections],
	checksum: testChecksum(doc),
}));

// ─── Logger ──────────────────────────────────────────────────────────────────

const logger = {
	info: (obj: Record<string, unknown>) =>
		console.log("[INFO]", JSON.stringify(obj)),
	error: (obj: Record<string, unknown>) =>
		console.error("[ERROR]", JSON.stringify(obj)),
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
	const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

	if (!process.env.E2B_API_KEY) {
		console.error("E2B_API_KEY is required");
		process.exit(1);
	}
	if (!anthropicApiKey) {
		console.error("ANTHROPIC_API_KEY is required");
		process.exit(1);
	}

	// ─── Step 1: Set up sync endpoint ─────────────────────────────────────

	console.log("\n=== Phase 4 Integration Test ===\n");

	const documentRepository = new InMemoryDocumentRepository();
	documentRepository.seed(TEST_USER_ID, testDocuments);

	const syncApp = createSyncEndpoint(documentRepository);
	const SYNC_PORT = 9876;
	const server = serve({
		fetch: syncApp.fetch,
		port: SYNC_PORT,
	});
	const syncEndpointOrigin = `http://host.docker.internal:${SYNC_PORT}`;
	console.log(`1. Sync endpoint running at http://localhost:${SYNC_PORT}`);
	console.log(`   Sandbox will reach it at: ${syncEndpointOrigin}\n`);

	const sandboxManager = new SandboxManager();
	const sessionStore = new SessionStore();
	let sandbox: Awaited<
		ReturnType<typeof sandboxManager.getOrCreateSandbox>
	> | null = null;

	try {
		// ─── Step 2: Create sandbox and trigger sync ──────────────────────

		console.log("2. Creating sandbox and syncing documents...");
		const t0 = now();

		sandbox = await sandboxManager.getOrCreateSandbox(TEST_USER_ID, logger);
		const bootMs = now() - t0;
		console.log(`   Sandbox created: ${sandbox.sandboxId} (${bootMs}ms)`);

		const t1 = now();
		await sandboxManager.triggerSync(
			TEST_USER_ID,
			sandbox,
			syncEndpointOrigin,
			logger,
		);
		const status = await sandboxManager.waitForSync(sandbox, 60_000);
		const syncMs = now() - t1;
		console.log(
			`   Sync complete: ${status.status === "ready" ? status.documentCount : 0} docs (${syncMs}ms)`,
		);

		// Verify files on disk
		const docsRoot = sandboxManager.getDocsRoot(TEST_USER_ID);
		const lsResult = await sandbox.commands.run(
			`find ${docsRoot} -name '*.txt' | sort`,
			{ timeoutMs: 5000 },
		);
		const files = lsResult.stdout.trim().split("\n").filter(Boolean);
		console.log(`   Files on disk: ${files.length}`);
		for (const f of files) {
			console.log(`     ${f}`);
		}
		console.log();

		// ─── Step 3: First query (general scope) ─────────────────────────

		console.log("3. Running first query (general scope)...");
		const query1 = "What is the engineering budget for Q4 2025?";
		console.log(`   Query: "${query1}"\n`);

		let text1 = "";
		let sessionId1: string | null = null;
		const t2 = now();

		await runSandboxAgent({
			sandbox,
			docsRoot,
			anthropicApiKey,
			query: query1,
			scope: "general",
			collectionId: null,
			summaryId: null,
			sessionId: null,
			onTextDelta: (text) => {
				text1 += text;
				process.stdout.write(text);
			},
			onTextEnd: async () => {
				console.log("\n");
			},
			onSessionId: (id) => {
				sessionId1 = id;
			},
			logger,
		});

		const agent1Ms = now() - t2;
		console.log(`   Agent completed (${agent1Ms}ms)`);
		console.log(`   Session ID: ${sessionId1 ?? "none"}`);

		const citations1 = extractReferencesFromText(text1);
		console.log(`   Citations: ${citations1.length}`);
		for (const c of citations1) {
			console.log(`     [c${c.index}]: type=${c.type}, id=${c.id}`);
		}
		console.log();

		// Store session for resume
		if (sessionId1) {
			sessionStore.setSessionId("test-chat-key", sessionId1, TEST_USER_ID);
		}

		// ─── Step 4: Second query with session resume ────────────────────

		console.log("4. Running second query (session resume)...");
		const query2 =
			"You mentioned the engineering budget earlier. What are the specific allocations within it?";
		console.log(`   Query: "${query2}"`);
		console.log(
			`   Resuming session: ${sessionStore.getSessionId("test-chat-key") ?? "none"}\n`,
		);

		let text2 = "";
		const t3 = now();

		await runSandboxAgent({
			sandbox,
			docsRoot,
			anthropicApiKey,
			query: query2,
			scope: "general",
			collectionId: null,
			summaryId: null,
			sessionId: sessionStore.getSessionId("test-chat-key"),
			onTextDelta: (text) => {
				text2 += text;
				process.stdout.write(text);
			},
			onTextEnd: async () => {
				console.log("\n");
			},
			onSessionId: (id) => {
				sessionStore.setSessionId("test-chat-key", id, TEST_USER_ID);
			},
			logger,
		});

		const agent2Ms = now() - t3;
		console.log(`   Agent completed (${agent2Ms}ms)`);

		const citations2 = extractReferencesFromText(text2);
		console.log(`   Citations: ${citations2.length}`);
		for (const c of citations2) {
			console.log(`     [c${c.index}]: type=${c.type}, id=${c.id}`);
		}
		console.log();

		// ─── Summary ─────────────────────────────────────────────────────

		const totalMs = now() - t0;
		const pass = citations1.length > 0 && text1.length > 0 && text2.length > 0;

		console.log("=== Results ===");
		console.log(`Boot:              ${bootMs}ms`);
		console.log(`Sync:              ${syncMs}ms`);
		console.log(`Agent (query 1):   ${agent1Ms}ms`);
		console.log(`Agent (query 2):   ${agent2Ms}ms`);
		console.log(`Total:             ${totalMs}ms`);
		console.log(`Query 1 citations: ${citations1.length}`);
		console.log(`Query 2 citations: ${citations2.length}`);
		console.log(
			`Session resume:    ${sessionId1 ? "captured" : "not captured"}`,
		);
		console.log(`Status:            ${pass ? "PASS" : "FAIL"}\n`);
	} finally {
		console.log("Cleaning up...");
		if (sandbox) {
			await sandboxManager.killSandbox(TEST_USER_ID, sandbox, logger);
		}
		server.stop();
		console.log("Done.\n");
	}
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
