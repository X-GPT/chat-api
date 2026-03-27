/**
 * Phase 2 integration test: exercises the full sync lifecycle against a real E2B sandbox.
 *
 * Usage:
 *   E2B_TEMPLATE=sandbox-template-dev bun run scripts/run-sync-integration.ts
 *
 * Requires: E2B_API_KEY and E2B_TEMPLATE environment variables.
 *
 * Steps:
 *   1. Create sandbox, full sync 3 documents
 *   2. Verify files exist on sandbox
 *   3. Update one document, re-sync → verify update applied
 *   4. Delete one document from source, re-sync → verify removal
 *   5. Introduce drift (orphaned file + tampered content), verify manifest, repair
 *   6. Rebuild sandbox from scratch
 *   7. Cleanup
 */
import { Sandbox } from "e2b";
import type { ProtectedSummary } from "../src/features/chat/api/types";
import {
	getDocsRoot,
	InMemorySyncStateRepository,
	type MaterializationConfig,
	SandboxSyncService,
} from "../src/features/sandbox";

const now = () => Date.now();

const makeSummary = (
	id: string,
	content: string,
	overrides: Partial<ProtectedSummary> = {},
): ProtectedSummary => ({
	id,
	type: 0,
	content,
	parseContent: null,
	title: `Document ${id}`,
	summaryTitle: null,
	fileType: null,
	delFlag: 0,
	updateTime: new Date().toISOString(),
	...overrides,
});

const assert = (condition: boolean, message: string) => {
	if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
};

const main = async () => {
	if (!Bun.env.E2B_API_KEY) {
		throw new Error("E2B_API_KEY is required.");
	}
	const template = Bun.env.E2B_TEMPLATE?.trim();
	if (!template) {
		throw new Error("E2B_TEMPLATE is required.");
	}

	const userId = "integration-test-user";
	const repository = new InMemorySyncStateRepository();
	const logs: Array<Record<string, unknown>> = [];
	const logger = {
		info(obj: Record<string, unknown>) {
			logs.push({ level: "info", ...obj });
		},
		error(obj: Record<string, unknown>) {
			logs.push({ level: "error", ...obj });
		},
	};
	const service = new SandboxSyncService({ repository, logger });
	const config: MaterializationConfig = {
		workspaceRoot: "/workspace/sandbox-prototype",
		userId,
	};
	const docsRoot = getDocsRoot(config);

	console.log("Creating sandbox...");
	const t0 = now();
	const sandbox = await Sandbox.create(template, {
		metadata: { userId, purpose: "phase2-sync-integration" },
	});
	console.log(`  Sandbox created in ${now() - t0}ms: ${sandbox.sandboxId}`);

	try {
		// ── Step 1: Initial full sync ───────────────────────────────
		console.log("\n── Step 1: Initial full sync (3 documents)");
		const docs = [
			makeSummary("doc-1", "Content of document one"),
			makeSummary("doc-2", "Content of document two"),
			makeSummary("doc-3", "Content of document three", { type: 3 }),
		];

		const t1 = now();
		const plan1 = await service.syncUser(
			userId,
			sandbox.sandboxId,
			sandbox,
			docs,
			config,
		);
		console.log(`  Synced in ${now() - t1}ms`);
		console.log(
			`  Creates: ${plan1.creates.length}, Updates: ${plan1.updates.length}, Deletes: ${plan1.deletes.length}, Unchanged: ${plan1.unchanged}`,
		);
		assert(plan1.creates.length === 3, "Expected 3 creates");
		assert(plan1.updates.length === 0, "Expected 0 updates");
		assert(plan1.deletes.length === 0, "Expected 0 deletes");

		// ── Step 2: Verify files exist ─────────────────────────────
		console.log("\n── Step 2: Verify files exist on sandbox");
		const t2 = now();
		const diff2 = await service.verifyManifest(
			userId,
			sandbox.sandboxId,
			sandbox,
			config,
		);
		console.log(`  Verified in ${now() - t2}ms`);
		console.log(
			`  Missing: ${diff2.missingInSandbox.length}, Orphaned: ${diff2.orphanedInSandbox.length}, Checksum mismatches: ${diff2.checksumMismatches.length}`,
		);
		assert(diff2.missingInSandbox.length === 0, "No files should be missing");
		assert(diff2.orphanedInSandbox.length === 0, "No files should be orphaned");
		assert(
			diff2.checksumMismatches.length === 0,
			"No checksum mismatches expected",
		);

		// ── Step 3: Update one document ────────────────────────────
		console.log("\n── Step 3: Update doc-2 content, re-sync");
		const docsUpdated = [
			makeSummary("doc-1", "Content of document one"),
			makeSummary("doc-2", "UPDATED content of document two"),
			makeSummary("doc-3", "Content of document three", { type: 3 }),
		];

		const t3 = now();
		const plan3 = await service.syncUser(
			userId,
			sandbox.sandboxId,
			sandbox,
			docsUpdated,
			config,
		);
		console.log(`  Synced in ${now() - t3}ms`);
		console.log(
			`  Creates: ${plan3.creates.length}, Updates: ${plan3.updates.length}, Deletes: ${plan3.deletes.length}, Unchanged: ${plan3.unchanged}`,
		);
		assert(plan3.updates.length === 1, "Expected 1 update");
		assert(plan3.unchanged === 2, "Expected 2 unchanged");

		// Verify updated content on disk
		const updatedContent = await sandbox.files.read(`${docsRoot}/0/doc-2.txt`);
		assert(
			updatedContent.includes("UPDATED content"),
			"Updated content should be on disk",
		);

		// ── Step 4: Delete one document from source ────────────────
		console.log("\n── Step 4: Remove doc-3 from source, re-sync");
		const docsReduced = [
			makeSummary("doc-1", "Content of document one"),
			makeSummary("doc-2", "UPDATED content of document two"),
		];

		const t4 = now();
		const plan4 = await service.syncUser(
			userId,
			sandbox.sandboxId,
			sandbox,
			docsReduced,
			config,
		);
		console.log(`  Synced in ${now() - t4}ms`);
		console.log(
			`  Creates: ${plan4.creates.length}, Updates: ${plan4.updates.length}, Deletes: ${plan4.deletes.length}, Unchanged: ${plan4.unchanged}`,
		);
		assert(plan4.deletes.length === 1, "Expected 1 delete");
		assert(plan4.unchanged === 2, "Expected 2 unchanged");

		// Verify file is gone
		const listResult = await sandbox.commands.run(
			`find ${docsRoot} -type f -name '*.txt'`,
			{ timeoutMs: 5_000 },
		);
		const remainingFiles = listResult.stdout.trim().split("\n").filter(Boolean);
		assert(
			remainingFiles.length === 2,
			`Expected 2 files remaining, got ${remainingFiles.length}`,
		);
		assert(
			!remainingFiles.some((f) => f.includes("doc-3")),
			"doc-3 should be removed",
		);

		// ── Step 5: Drift detection and repair ─────────────────────
		console.log("\n── Step 5: Introduce drift, verify, repair");

		// Create an orphaned file
		await sandbox.files.write(`${docsRoot}/0/orphan.txt`, "I should not exist");
		// Tamper with doc-1
		await sandbox.files.write(`${docsRoot}/0/doc-1.txt`, "tampered content");

		const t5 = now();
		const diff5 = await service.verifyManifest(
			userId,
			sandbox.sandboxId,
			sandbox,
			config,
		);
		console.log(`  Drift detected in ${now() - t5}ms`);
		console.log(
			`  Missing: ${diff5.missingInSandbox.length}, Orphaned: ${diff5.orphanedInSandbox.length}, Checksum mismatches: ${diff5.checksumMismatches.length}`,
		);
		assert(
			diff5.orphanedInSandbox.length === 1,
			"Expected 1 orphaned file (orphan.txt)",
		);
		assert(
			diff5.checksumMismatches.length === 1,
			"Expected 1 checksum mismatch (doc-1)",
		);

		// Repair
		const t5r = now();
		await service.repairDrift(
			userId,
			sandbox.sandboxId,
			sandbox,
			diff5,
			docsReduced,
			config,
		);
		console.log(`  Repaired in ${now() - t5r}ms`);

		// Verify clean after repair
		const diff5post = await service.verifyManifest(
			userId,
			sandbox.sandboxId,
			sandbox,
			config,
		);
		assert(
			diff5post.missingInSandbox.length === 0,
			"No files should be missing after repair",
		);
		assert(diff5post.orphanedInSandbox.length === 0, "No orphans after repair");
		assert(
			diff5post.checksumMismatches.length === 0,
			"No mismatches after repair",
		);

		// ── Step 6: Full rebuild ───────────────────────────────────
		console.log("\n── Step 6: Full sandbox rebuild");
		const t6 = now();
		const plan6 = await service.rebuildSandbox(
			userId,
			sandbox.sandboxId,
			sandbox,
			docsReduced,
			config,
		);
		console.log(`  Rebuilt in ${now() - t6}ms`);
		console.log(
			`  Creates: ${plan6.creates.length}, Updates: ${plan6.updates.length}, Deletes: ${plan6.deletes.length}, Unchanged: ${plan6.unchanged}`,
		);
		assert(
			plan6.creates.length === 2,
			"Rebuild should create all 2 docs fresh",
		);

		const diff6 = await service.verifyManifest(
			userId,
			sandbox.sandboxId,
			sandbox,
			config,
		);
		assert(diff6.missingInSandbox.length === 0, "Clean after rebuild");
		assert(diff6.orphanedInSandbox.length === 0, "Clean after rebuild");

		// ── Summary ────────────────────────────────────────────────
		const totalMs = now() - t0;
		console.log("\n── All steps passed ──");
		console.log(`  Total time: ${totalMs}ms`);
		console.log(`  Sandbox: ${sandbox.sandboxId}`);
		console.log(`  Log entries: ${logs.length}`);
	} finally {
		console.log("\nCleaning up sandbox...");
		sandbox.kill().catch(() => {});
	}
};

await main();
