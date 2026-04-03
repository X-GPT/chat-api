/**
 * Integration test: real E2B sandbox, mocked Protected API.
 *
 * Tests initial sync and incremental sync independently, each with its own sandbox.
 *
 * Usage:
 *   bun run scripts/run-sync-integration.ts
 *
 * Requires: E2B_API_KEY (via env or .env)
 */

import assert from "node:assert/strict";
import type { Sandbox } from "e2b";
import type { ManifestEntry } from "@/features/chat/api/manifest";
import type { FullSummary, ProtectedSummary } from "@/features/chat/api/types";
import type { SyncLogger } from "@/features/sandbox";
import { getDocsRoot } from "@/features/sandbox";
import { computeChecksum } from "@/features/sandbox/materialization";
import {
	SandboxManager,
	WORKSPACE_ROOT,
} from "@/features/sandbox-orchestration/sandbox-manager";
import {
	ensureInitialSync,
	getSyncStatus,
	runIncrementalSync,
} from "@/features/sandbox-orchestration/sandbox-sync-service";
import type { SyncFetchers } from "@/features/sandbox-orchestration/sandbox-sync-types";

// ── Timing ───────────────────────────────────────────────────────────

interface TimingEntry {
	label: string;
	ms: number;
}

interface E2eSummary {
	label: string;
	ms: number;
	detail: string;
}

const timings: TimingEntry[] = [];
const e2eSummaries: E2eSummary[] = [];

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
	const start = performance.now();
	const result = await fn();
	const ms = performance.now() - start;
	timings.push({ label, ms });
	console.log(`  [${ms.toFixed(0)}ms] ${label}`);
	return result;
}

function printTimingSummary() {
	const totalMs = timings.reduce((sum, t) => sum + t.ms, 0);
	console.log("Step-by-step breakdown:");
	console.log(
		"┌─────────────────────────────────────────────────┬──────────┐",
	);
	console.log(
		"│ Step                                            │ Latency  │",
	);
	console.log(
		"├─────────────────────────────────────────────────┼──────────┤",
	);
	for (const { label, ms } of timings) {
		console.log(
			`│ ${label.padEnd(47)} │ ${`${ms.toFixed(0)}ms`.padStart(8)} │`,
		);
	}
	console.log(
		"├─────────────────────────────────────────────────┼──────────┤",
	);
	console.log(
		`│ ${"Total".padEnd(47)} │ ${`${totalMs.toFixed(0)}ms`.padStart(8)} │`,
	);
	console.log(
		"└─────────────────────────────────────────────────┴──────────┘",
	);

	console.log("\nE2E sync latency:");
	console.log(
		"┌─────────────────────────────────────────────────┬──────────┬────────────────────┐",
	);
	console.log(
		"│ Scenario                                        │ Latency  │ Detail             │",
	);
	console.log(
		"├─────────────────────────────────────────────────┼──────────┼────────────────────┤",
	);
	for (const { label, ms, detail } of e2eSummaries) {
		console.log(
			`│ ${label.padEnd(47)} │ ${`${ms.toFixed(0)}ms`.padStart(8)} │ ${detail.padEnd(18)} │`,
		);
	}
	console.log(
		"└─────────────────────────────────────────────────┴──────────┴────────────────────┘",
	);
}

// ── Helpers ──────────────────────────────────────────────────────────

const logger: SyncLogger = {
	info(obj) {
		console.log("[info]", obj.msg ?? "", obj);
	},
	error(obj) {
		console.error("[error]", obj.msg ?? "", obj);
	},
};

const FILE_COUNT = 20;

function makeSummary(
	id: string,
	content: string,
	overrides: Partial<ProtectedSummary> = {},
): ProtectedSummary {
	return {
		id,
		title: `Title ${id}`,
		content,
		type: 0,
		fileType: "text/plain",
		...overrides,
	};
}

function makeFullSummary(
	id: string,
	content: string,
	collectionIds: string[] = [],
	overrides: Partial<ProtectedSummary> = {},
): FullSummary {
	const summary = makeSummary(id, content, overrides);
	const body = [
		"---",
		`summaryId: ${id}`,
		`type: ${summary.type ?? 0}`,
		"sourceKind: text",
		`title: ${JSON.stringify(summary.title?.trim() ?? "")}`,
		"---",
		"",
		content.trim(),
		"",
	].join("\n");
	return {
		...summary,
		checksum: computeChecksum(body),
		collectionIds,
	};
}

function generateInitialSummaries(count: number): FullSummary[] {
	return Array.from({ length: count }, (_, i) => {
		const id = `sum-${i + 1}`;
		const colId = `col-${String.fromCharCode(65 + (i % 3))}`;
		return makeFullSummary(
			id,
			`Content for document ${i + 1}. `.repeat(10),
			[colId],
		);
	});
}

const INITIAL_SUMMARIES = generateInitialSummaries(FILE_COUNT);

function buildMockFetchers(): {
	fetchers: SyncFetchers;
	setManifest: (m: ManifestEntry[]) => void;
	setSummaries: (s: ProtectedSummary[]) => void;
	getFetchCount: () => number;
	resetFetchCount: () => void;
} {
	let currentManifest: ManifestEntry[] = [];
	let summariesForFetch: ProtectedSummary[] = [];
	let fetchCount = 0;

	return {
		fetchers: {
			async fetchAllFullSummaries() {
				return INITIAL_SUMMARIES;
			},
			async fetchSummariesManifest() {
				return currentManifest;
			},
			async fetchProtectedSummaries(ids) {
				fetchCount++;
				return summariesForFetch.filter((s) => ids.includes(s.id));
			},
		},
		setManifest: (m) => {
			currentManifest = m;
		},
		setSummaries: (s) => {
			summariesForFetch = s;
		},
		getFetchCount: () => fetchCount,
		resetFetchCount: () => {
			fetchCount = 0;
		},
	};
}

// ── Test 1: Initial Sync ─────────────────────────────────────────────

async function testInitialSync(sandboxManager: SandboxManager) {
	const userId = "initial-sync-test";
	const docsRoot = getDocsRoot({ workspaceRoot: WORKSPACE_ROOT, userId });
	const syncOptions = {
		memberCode: userId,
		partnerCode: "partner-1",
		memberAuthToken: "token-123",
	};
	const mock = buildMockFetchers();

	console.log(`\n========== Test 1: Initial Sync (${FILE_COUNT} files) ==========\n`);

	const sandbox = await timed("[initial] getOrCreateSandbox", () =>
		sandboxManager.getOrCreateSandbox(userId, logger),
	);
	console.log(`Sandbox: ${sandbox.sandboxId}`);

	await timed("[initial] clean docs dir", () =>
		sandbox.commands.run(`rm -rf ${docsRoot}`),
	);

	const ctx = {
		userId,
		sandbox,
		options: syncOptions,
		logger,
		fetchers: mock.fetchers,
	};

	const e2eStart = performance.now();

	await timed("[initial] ensureInitialSync", () =>
		ensureInitialSync(ctx),
	);

	const e2eMs = performance.now() - e2eStart;
	e2eSummaries.push({
		label: "Initial sync (e2e)",
		ms: e2eMs,
		detail: `${FILE_COUNT} files`,
	});

	// Verify status is synced
	const status = await getSyncStatus({ sandbox, docsRoot });
	assert.equal(status.status, "synced", "status should be synced after initial sync");

	await timed("[initial] verify", async () => {
		const file1 = await sandbox.files.read(`${docsRoot}/0/sum-1.txt`);
		assert.ok(file1.includes("summaryId: sum-1"), "file1 ok");

		const fileLast = await sandbox.files.read(
			`${docsRoot}/0/sum-${FILE_COUNT}.txt`,
		);
		assert.ok(
			fileLast.includes(`summaryId: sum-${FILE_COUNT}`),
			"last file ok",
		);

		const marker = await sandbox.files.read(`${docsRoot}/.sync-complete`);
		assert.ok(marker, ".sync-complete exists");

		const stateRaw = await sandbox.files.read(
			`${docsRoot}/.sync-state.json`,
		);
		const parsed = JSON.parse(stateRaw);
		assert.equal(parsed.length, FILE_COUNT, `state has ${FILE_COUNT} entries`);

		const readlinkResult = await sandbox.commands.run(
			`readlink ${docsRoot}/collections/col-A/0/sum-1.txt`,
		);
		assert.ok(
			readlinkResult.stdout.trim().includes("sum-1.txt"),
			"symlink resolves",
		);
	});

	console.log("PASS");
}

// ── Test 2: Incremental Sync ─────────────────────────────────────────

async function testIncrementalSync(sandboxManager: SandboxManager) {
	const userId = "incremental-sync-test";
	const docsRoot = getDocsRoot({ workspaceRoot: WORKSPACE_ROOT, userId });
	const syncOptions = {
		memberCode: userId,
		partnerCode: "partner-1",
		memberAuthToken: "token-123",
	};
	const mock = buildMockFetchers();

	console.log(
		`\n========== Test 2: Incremental Sync (${FILE_COUNT} files base) ==========\n`,
	);

	const sandbox = await timed("[incremental] getOrCreateSandbox", () =>
		sandboxManager.getOrCreateSandbox(userId, logger),
	);
	console.log(`Sandbox: ${sandbox.sandboxId}`);

	// ── Setup: seed with initial sync (untimed) ──────────────────
	console.log("\n  Setting up: running initial sync to seed sandbox...");
	await sandbox.commands.run(`rm -rf ${docsRoot}`);

	const setupCtx = {
		userId,
		sandbox,
		options: syncOptions,
		logger,
		fetchers: mock.fetchers,
	};

	await ensureInitialSync(setupCtx);
	console.log("  Setup complete.\n");

	// ── Scenario A: 10 content changes ───────────────────────────
	const CHANGE_COUNT = 10;
	console.log(`--- Scenario A: ${CHANGE_COUNT} content changes ---`);

	const stateRaw = await sandbox.files.read(`${docsRoot}/.sync-state.json`);
	const state: any[] = JSON.parse(stateRaw);

	mock.setManifest(
		state.map((e: any, i: number) => ({
			id: e.id,
			checksum: i < CHANGE_COUNT ? `changed-${e.id}` : e.checksum,
			collectionIds: e.collectionIds ?? [],
		})),
	);
	mock.setSummaries(
		Array.from({ length: CHANGE_COUNT }, (_, i) =>
			makeSummary(`sum-${i + 1}`, `Updated content for doc ${i + 1}`),
		),
	);
	mock.resetFetchCount();

	let e2eStart = performance.now();
	await timed(`[incremental] sync (${CHANGE_COUNT} changes)`, () =>
		runIncrementalSync(setupCtx),
	);
	let e2eMs = performance.now() - e2eStart;
	e2eSummaries.push({
		label: "Incremental: content change (e2e)",
		ms: e2eMs,
		detail: `${CHANGE_COUNT} changed`,
	});

	await timed("[incremental] verify changes", async () => {
		const updated = await sandbox.files.read(`${docsRoot}/0/sum-1.txt`);
		assert.ok(updated.includes("Updated content for doc 1"), "changed file ok");

		const unchanged = await sandbox.files.read(
			`${docsRoot}/0/sum-${CHANGE_COUNT + 1}.txt`,
		);
		assert.ok(
			unchanged.includes(`Content for document ${CHANGE_COUNT + 1}`),
			"unchanged file ok",
		);

		const newState = JSON.parse(
			await sandbox.files.read(`${docsRoot}/.sync-state.json`),
		);
		assert.equal(newState.length, FILE_COUNT, "state has all entries");
		const changed = newState.find((e: any) => e.id === "sum-1");
		assert.equal(changed.checksum, "changed-sum-1", "checksum updated");
	});

	console.log("PASS\n");

	// ── Scenario B: 5 deletions ──────────────────────────────────
	const DELETE_COUNT = 5;
	console.log(`--- Scenario B: ${DELETE_COUNT} deletions ---`);

	const stateBeforeDelete: any[] = JSON.parse(
		await sandbox.files.read(`${docsRoot}/.sync-state.json`),
	);

	const deleteIds = new Set(
		Array.from({ length: DELETE_COUNT }, (_, i) => `sum-${i + 1}`),
	);
	const keptEntries = stateBeforeDelete.filter(
		(e: any) => !deleteIds.has(e.id),
	);
	mock.setManifest(
		keptEntries.map((e: any) => ({
			id: e.id,
			checksum: e.checksum,
			collectionIds: e.collectionIds ?? [],
		})),
	);
	mock.setSummaries([]);
	mock.resetFetchCount();

	e2eStart = performance.now();
	await timed(`[incremental] sync (${DELETE_COUNT} deletions)`, () =>
		runIncrementalSync(setupCtx),
	);
	e2eMs = performance.now() - e2eStart;
	e2eSummaries.push({
		label: "Incremental: deletion (e2e)",
		ms: e2eMs,
		detail: `${DELETE_COUNT} deleted`,
	});

	await timed("[incremental] verify deletions", async () => {
		const lsResult = await sandbox.commands.run(
			`test -f ${docsRoot}/0/sum-1.txt && echo exists || echo missing`,
		);
		assert.equal(lsResult.stdout.trim(), "missing", "deleted file gone");

		const survivorId = `sum-${DELETE_COUNT + 1}`;
		const remaining = await sandbox.files.read(
			`${docsRoot}/0/${survivorId}.txt`,
		);
		assert.ok(remaining.includes(`summaryId: ${survivorId}`), "survivor ok");

		const stateAfter = JSON.parse(
			await sandbox.files.read(`${docsRoot}/.sync-state.json`),
		);
		assert.equal(stateAfter.length, FILE_COUNT - DELETE_COUNT, "state updated");
	});

	console.log("PASS\n");

	// ── Scenario C: no changes ───────────────────────────────────
	console.log("--- Scenario C: no changes ---");

	const stateForNoop = JSON.parse(
		await sandbox.files.read(`${docsRoot}/.sync-state.json`),
	);
	mock.setManifest(
		stateForNoop.map((e: any) => ({
			id: e.id,
			checksum: e.checksum,
			collectionIds: e.collectionIds ?? [],
		})),
	);
	mock.setSummaries([]);
	mock.resetFetchCount();

	e2eStart = performance.now();
	await timed("[incremental] sync (no-op)", () =>
		runIncrementalSync(setupCtx),
	);
	e2eMs = performance.now() - e2eStart;
	e2eSummaries.push({
		label: "Incremental: no-op (e2e)",
		ms: e2eMs,
		detail: "0 changes",
	});

	assert.equal(mock.getFetchCount(), 0, "fetchProtectedSummaries not called");

	console.log("PASS");
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
	console.log("=== Sandbox Sync Integration Test ===");

	const sandboxManager = new SandboxManager();

	await testInitialSync(sandboxManager);
	await testIncrementalSync(sandboxManager);

	console.log("\n\n=== All tests passed ===\n");
	printTimingSummary();
}

main().catch((err) => {
	console.error("\nFAILED:", err);
	process.exit(1);
});
