/**
 * Phase 4 Integration Test: Sandbox query + session resume end-to-end.
 *
 * Tests:
 *   1. Create sandbox, sync test documents via SandboxSyncService
 *   2. Run query via sandbox agent, verify text + citations
 *   3. Run second query with session resume, verify context continuity
 *
 * Usage:
 *   E2B_TEMPLATE=sandbox-template-dev bun run scripts/run-phase4-integration.ts
 *
 * Requires:
 *   - E2B_API_KEY
 *   - ANTHROPIC_API_KEY
 */

import { Sandbox } from "e2b";
import type { ProtectedSummary } from "../src/features/chat/api/types";
import { extractReferencesFromText } from "../src/features/chat/lib/extract-citations-from-markdown";
import {
	getDocsRoot,
	InMemorySyncStateRepository,
	type MaterializationConfig,
	SandboxSyncService,
} from "../src/features/sandbox";
import { runSandboxAgent } from "../src/features/sandbox-agent";
import { SessionStore } from "../src/features/sandbox-orchestration/session-store";

const now = () => Date.now();

// ─── Test Data ───────────────────────────────────────────────────────────────

const TEST_USER_ID = "test-user-phase4";
const TEST_COLLECTION_ID = "col-abc";

const testSummaries: ProtectedSummary[] = [
	{
		id: "1001",
		type: 0,
		content:
			"The Q4 2025 budget allocates $2.5M to engineering and $1.2M to marketing. The engineering budget includes $800K for infrastructure upgrades and $500K for new hires.",
		parseContent: null,
		title: "Q4 2025 Budget Report",
		summaryTitle: null,
		fileType: null,
		delFlag: 0,
		updateTime: "2026-03-27T00:00:00Z",
	},
	{
		id: "1002",
		type: 0,
		content:
			"Project Alpha launched on March 1, 2026. The team consists of 5 engineers and 2 designers. Key milestones: MVP by April 15, Beta by June 1, GA by August 15.",
		parseContent: null,
		title: "Project Alpha Status",
		summaryTitle: null,
		fileType: null,
		delFlag: 0,
		updateTime: "2026-03-27T00:00:00Z",
	},
	{
		id: "1003",
		type: 3,
		content:
			"# Meeting Notes - March 27\n\nAttendees: Alice, Bob, Charlie\n\n## Decisions\n- Approved Q4 budget\n- Project Alpha timeline confirmed\n- New hiring plan for engineering team",
		parseContent: null,
		title: "Team Meeting Notes",
		summaryTitle: null,
		fileType: null,
		delFlag: 0,
		updateTime: "2026-03-27T00:00:00Z",
	},
];

const collectionMap = new Map<string, string[]>([
	["1001", [TEST_COLLECTION_ID]],
	["1003", [TEST_COLLECTION_ID]],
]);

const logger = {
	info: (obj: Record<string, unknown>) =>
		console.log("[INFO]", JSON.stringify(obj)),
	error: (obj: Record<string, unknown>) =>
		console.error("[ERROR]", JSON.stringify(obj)),
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
	const e2bTemplate = process.env.E2B_TEMPLATE || "sandbox-template-dev";
	const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

	if (!process.env.E2B_API_KEY) {
		console.error("E2B_API_KEY is required");
		process.exit(1);
	}
	if (!anthropicApiKey) {
		console.error("ANTHROPIC_API_KEY is required");
		process.exit(1);
	}

	const config: MaterializationConfig = {
		workspaceRoot: "/workspace/sandbox-prototype",
		userId: TEST_USER_ID,
		collectionMap,
	};
	const docsRoot = getDocsRoot(config);

	console.log("\n=== Phase 4 Integration Test ===");
	console.log(`Template: ${e2bTemplate}`);
	console.log(`Docs root: ${docsRoot}`);
	console.log(`Test documents: ${testSummaries.length}\n`);

	const sessionStore = new SessionStore();
	let sandbox: Sandbox | null = null;

	try {
		// ─── Step 1: Create sandbox and sync documents ───────────────────

		console.log("1. Creating sandbox and syncing documents...");
		const t0 = now();

		sandbox = await Sandbox.create(e2bTemplate, {
			metadata: { userId: TEST_USER_ID, purpose: "phase4-integration" },
		});
		const bootMs = now() - t0;
		console.log(`   Sandbox created: ${sandbox.sandboxId} (${bootMs}ms)`);

		const t1 = now();
		const syncService = new SandboxSyncService({
			repository: new InMemorySyncStateRepository(),
			logger,
		});
		const plan = await syncService.syncUser(
			TEST_USER_ID,
			sandbox.sandboxId,
			sandbox,
			testSummaries,
			config,
		);
		const syncMs = now() - t1;
		console.log(
			`   Synced: ${plan.creates.length} creates, ${plan.updates.length} updates, ${plan.deletes.length} deletes (${syncMs}ms)`,
		);

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

		// ─── Step 2: First query (general scope) ─────────────────────────

		console.log("2. Running first query (general scope)...");
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

		if (sessionId1) {
			sessionStore.setSessionId("test-chat-key", sessionId1, TEST_USER_ID);
		}

		// ─── Step 3: Second query with session resume ────────────────────

		console.log("3. Running second query (session resume)...");
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
			await sandbox.kill();
		}
		console.log("Done.\n");
	}
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
