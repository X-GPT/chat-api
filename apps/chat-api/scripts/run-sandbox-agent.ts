/**
 * Live E2B integration test for the sandbox agent.
 *
 * Usage:
 *   E2B_TEMPLATE=sandbox-template-dev bun run scripts/run-sandbox-agent.ts
 *
 * Requires:
 *   - E2B_API_KEY (in env or sandbox-template/.env)
 *   - E2B_TEMPLATE (sandbox template name)
 *   - ANTHROPIC_API_KEY (for the agent inside the sandbox)
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

const now = () => Date.now();

// ─── Test Data ───────────────────────────────────────────────────────────────

const TEST_USER_ID = "test-user-1";
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

/** Collection map: docs 1001 and 1003 belong to the test collection */
const collectionMap = new Map<string, string[]>([
	["1001", [TEST_COLLECTION_ID]],
	["1003", [TEST_COLLECTION_ID]],
]);

// ─── Logger ──────────────────────────────────────────────────────────────────

const logger = {
	info: (obj: Record<string, unknown>) =>
		console.log("[INFO]", JSON.stringify(obj)),
	error: (obj: Record<string, unknown>) =>
		console.error("[ERROR]", JSON.stringify(obj)),
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
	// Validate env
	const e2bApiKey = process.env.E2B_API_KEY;
	const e2bTemplate = process.env.E2B_TEMPLATE || "sandbox-template-dev";
	const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

	if (!e2bApiKey) {
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

	console.log(`\n=== Sandbox Agent Integration Test ===`);
	console.log(`Template: ${e2bTemplate}`);
	console.log(`Docs root: ${docsRoot}`);
	console.log(`Test documents: ${testSummaries.length}`);
	console.log(
		`Collection: ${TEST_COLLECTION_ID} (${collectionMap.size} docs)\n`,
	);

	// ─── Step 1: Create sandbox ────────────────────────────────────────────

	const t0 = now();
	console.log("1. Creating sandbox...");
	const sandbox = await Sandbox.create(e2bTemplate, {
		metadata: { userId: TEST_USER_ID, purpose: "phase3-agent-integration" },
	});
	const bootMs = now() - t0;
	console.log(`   Sandbox created: ${sandbox.sandboxId} (${bootMs}ms)\n`);

	try {
		// ─── Step 2: Sync documents ──────────────────────────────────────────

		const t1 = now();
		console.log("2. Syncing documents...");
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

		// Verify files exist
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

		// ─── Step 3: Run agent (general scope) ────────────────────────────────

		console.log("3. Running agent (general scope)...");
		const query = "What is the engineering budget for Q4 2025?";
		console.log(`   Query: "${query}"\n`);

		let accumulatedText = "";
		const t2 = now();

		await runSandboxAgent({
			sandbox,
			docsRoot,
			anthropicApiKey,
			query,
			scope: "general",
			collectionId: null,
			summaryId: null,
			sessionId: null,
			onTextDelta: (text) => {
				accumulatedText += text;
				process.stdout.write(text);
			},
			onTextEnd: async () => {
				console.log("\n");
			},
			logger,
		});

		const agentMs = now() - t2;
		console.log(`   Agent completed (${agentMs}ms)\n`);

		// ─── Step 4: Verify citations ──────────────────────────────────────────

		console.log("4. Verifying citations...");
		const citations = extractReferencesFromText(accumulatedText);
		console.log(`   Found ${citations.length} citation(s):`);
		for (const c of citations) {
			console.log(`     [c${c.index}]: type=${c.type}, id=${c.id}`);
		}
		const citationsOk = citations.length > 0;
		console.log(`   Citations parseable: ${citationsOk}\n`);

		// ─── Step 5: Run agent (collection scope) ──────────────────────────────

		console.log("5. Running agent (collection scope)...");
		const collectionQuery = "What decisions were made in the meeting?";
		console.log(`   Query: "${collectionQuery}"\n`);

		let collectionText = "";
		const t3 = now();

		await runSandboxAgent({
			sandbox,
			docsRoot,
			anthropicApiKey,
			query: collectionQuery,
			scope: "collection",
			collectionId: TEST_COLLECTION_ID,
			summaryId: null,
			sessionId: null,
			onTextDelta: (text) => {
				collectionText += text;
				process.stdout.write(text);
			},
			onTextEnd: async () => {
				console.log("\n");
			},
			logger,
		});

		const collectionAgentMs = now() - t3;
		console.log(`   Agent completed (${collectionAgentMs}ms)\n`);

		const collectionCitations = extractReferencesFromText(collectionText);
		console.log(`   Found ${collectionCitations.length} citation(s):`);
		for (const c of collectionCitations) {
			console.log(`     [c${c.index}]: type=${c.type}, id=${c.id}`);
		}

		// ─── Summary ───────────────────────────────────────────────────────────

		const totalMs = now() - t0;
		console.log(`\n=== Results ===`);
		console.log(`Boot:             ${bootMs}ms`);
		console.log(`Sync:             ${syncMs}ms`);
		console.log(`Agent (general):  ${agentMs}ms`);
		console.log(`Agent (collection): ${collectionAgentMs}ms`);
		console.log(`Total:            ${totalMs}ms`);
		console.log(`General citations: ${citations.length}`);
		console.log(`Collection citations: ${collectionCitations.length}`);
		console.log(`Status: ${citationsOk ? "PASS" : "FAIL"}\n`);
	} finally {
		console.log("Cleaning up sandbox...");
		await sandbox.kill();
		console.log("Done.\n");
	}
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
