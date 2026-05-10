/**
 * E2B integration test for the sandbox daemon.
 *
 * Reads an existing member's data from the test Postgres DB — does not seed or
 * mutate knowledge/collection rows. Set INTEGRATION_MEMBER_CODE to pick a
 * specific member (default: H00000009, which has ~60 Nginx/gzip docs).
 *
 * Tests: deploy daemon → health check → DB reconciliation → turn execution → session persistence.
 *
 * Usage:
 *   bun run scripts/run-daemon-e2b-integration.ts
 *
 * Requires: E2B_API_KEY, ANTHROPIC_API_KEY, DATABASE_URL (via env or .env)
 */

import assert from "node:assert/strict";
import {
	platformCollection,
	platformKnowledge,
	platformKnowledgeCollection,
	userSandboxRuntime,
	userSandboxSessions,
} from "@mymemo/db";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Sandbox } from "e2b";
import { closeDb, getDb } from "@/db/client";
import { getRuntime } from "@/db/user-runtime";
import type { SyncLogger } from "@/features/sandbox";
import { buildSandboxAgentPrompt } from "@/features/sandbox-agent";
import {
	SandboxManager,
	WORKSPACE_ROOT,
} from "@/features/sandbox-orchestration/sandbox-manager";

const logger: SyncLogger = {
	info: (obj) => console.log("[INFO]", JSON.stringify(obj)),
	error: (obj) => console.error("[ERROR]", JSON.stringify(obj)),
};

const userId = process.env.INTEGRATION_MEMBER_CODE ?? "H00000009";

interface RealFixtures {
	// Collection compat_id or bigint::text, picked from a live collection that
	// has at least one live membership for this member.
	collectionId: string;
	// A live type-0 doc that belongs to the picked collection.
	docIdInCollection: string;
	// The doc's title for response sanity checks.
	docTitleInCollection: string;
}

let fixtures: RealFixtures | null = null;
let sandbox: Sandbox;
let daemonUrl: string;
const sandboxManager = new SandboxManager();
const db = getDb();

function prodPrompt(
	scope: "general" | "collection" | "document",
	opts: { summaryId?: string; collectionId?: string } = {},
): string {
	return buildSandboxAgentPrompt({
		scope,
		summaryId: opts.summaryId ?? null,
		collectionId: opts.collectionId ?? null,
		docsRoot: `${WORKSPACE_ROOT}/data/${userId}`,
		conversationContext: null,
	});
}

function extractFullText(events: Array<Record<string, unknown>>): string {
	return events
		.filter((e) => e.type === "text_delta")
		.map((e) => String(e.text ?? ""))
		.join("");
}

async function discoverFixtures(): Promise<RealFixtures> {
	console.log(`=== Discovering fixtures for member ${userId} ===`);

	// Find a collection with at least one live type-0 doc. Use `id::text` as
	// the daemon's document_id to match queries.ts (citation pipeline expects it).
	const rows = await db
		.select({
			doc_id: sql<string>`${platformKnowledge.id}::text`,
			title: platformKnowledge.title,
			collection_id: platformCollection.id,
			collection_compat_id: platformCollection.compatId,
		})
		.from(platformKnowledgeCollection)
		.innerJoin(
			platformKnowledge,
			eq(platformKnowledge.id, platformKnowledgeCollection.knowledgeId),
		)
		.innerJoin(
			platformCollection,
			eq(platformCollection.id, platformKnowledgeCollection.collectionId),
		)
		.where(
			and(
				eq(platformKnowledge.memberCode, userId),
				eq(platformKnowledge.delFlag, "0"),
				eq(platformCollection.delFlag, "0"),
				eq(platformKnowledge.type, 0),
				sql`LENGTH(${platformKnowledge.title}) > 0`,
			),
		)
		.orderBy(desc(platformKnowledge.updateTime))
		.limit(1);

	if (rows.length === 0) {
		throw new Error(
			`No live type-0 docs with titles + collection membership for member ${userId}`,
		);
	}
	const row = rows[0]!;
	const collectionId = row.collection_compat_id ?? String(row.collection_id);
	console.log(
		`✓ Picked doc ${row.doc_id} in collection ${collectionId} — "${row.title?.slice(0, 60)}"`,
	);
	return {
		collectionId,
		docIdInCollection: row.doc_id,
		docTitleInCollection: row.title ?? "",
	};
}

async function cleanupDaemonState() {
	await Promise.all([
		db.delete(userSandboxRuntime).where(eq(userSandboxRuntime.userId, userId)),
		db
			.delete(userSandboxSessions)
			.where(eq(userSandboxSessions.userId, userId)),
	]);
}

async function setup() {
	console.log("\n=== Setup: Creating sandbox ===");
	sandbox = await sandboxManager.getOrCreateSandbox(userId, logger);
	console.log(`Sandbox created: ${sandbox.sandboxId}`);
}

async function testDaemonDeployment() {
	console.log("\n=== Test 1: Daemon Deployment ===");
	daemonUrl = await sandboxManager.ensureSandboxDaemon(userId, sandbox, logger);
	console.log(`Daemon URL: ${daemonUrl}`);

	const healthRes = await fetch(`${daemonUrl}/health`);
	assert.equal(healthRes.status, 200, "Health should return 200");

	const health = (await healthRes.json()) as {
		status: string;
		version: string;
		uptime: number;
	};
	assert.equal(health.status, "ok");
	console.log(
		`✓ Daemon healthy: version=${health.version}, uptime=${health.uptime}s`,
	);
}

async function testCurrentEndpoint() {
	console.log("\n=== Test 2: Current Endpoint (idle) ===");
	const res = await fetch(`${daemonUrl}/current`);
	assert.equal(res.status, 200);

	const current = (await res.json()) as {
		busy: boolean;
		turnId: string | null;
	};
	assert.equal(current.busy, false);
	console.log("✓ Daemon reports idle");
}

async function testIdempotentDeploy() {
	console.log("\n=== Test 3: Daemon Idempotent Deployment ===");
	const start = performance.now();
	const url2 = await sandboxManager.ensureSandboxDaemon(userId, sandbox, logger);
	const elapsed = performance.now() - start;
	assert.equal(url2, daemonUrl);
	console.log(`✓ Idempotent deploy took ${elapsed.toFixed(0)}ms`);
}

async function dumpSandboxDiagnostics() {
	console.log("\n--- Sandbox Diagnostics ---");
	try {
		const health = await fetch(`${daemonUrl}/health`);
		console.log(`Daemon health: ${health.status}`);
	} catch (err) {
		console.log(`Daemon health fetch failed: ${err}`);
	}
	try {
		const ls = await sandbox.commands.run(
			`find ${WORKSPACE_ROOT}/data -name '*.md' -type f 2>/dev/null | head -20`,
			{ timeoutMs: 5_000 },
		);
		console.log(`Materialized files (head):\n${ls.stdout}`);
	} catch {}
	try {
		const logContent = await sandbox.files.read("/workspace/daemon.log");
		console.log(`Daemon logs:\n${logContent}`);
	} catch {
		console.log("Daemon logs: (no log file found)");
	}
	console.log("--- End Diagnostics ---\n");
}

async function testReconciliationAndTurn() {
	console.log("\n=== Test 4: Reconciliation + Turn Execution (real data) ===");

	const turnBody = {
		request_id: `turn-${Date.now()}`,
		user_id: userId,
		scope_type: "global",
		// A generic question that should work for most members: ask the agent
		// to summarize what it can see in the available documents.
		message: "List three titles of documents you can see, one per line.",
		system_prompt: prodPrompt("general"),
	};

	let res: Response;
	try {
		res = await fetch(`${daemonUrl}/turn`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(turnBody),
			signal: AbortSignal.timeout(180_000),
		});
	} catch (err) {
		console.log(
			`Turn request failed: ${err instanceof Error ? err.message : err}`,
		);
		await dumpSandboxDiagnostics();
		throw err;
	}

	assert.equal(res.status, 200);
	const text = await res.text();
	const events = parseEvents(text);
	const types = events.map((e) => e.type);
	console.log(`Event types: ${types.join(", ")}`);

	if (!types.includes("text_delta")) {
		console.log(`Raw response:\n${text}`);
		await dumpSandboxDiagnostics();
	}

	assert.ok(types.includes("started"), "Should have started event");
	assert.ok(types.includes("text_delta"), "Should have text_delta events");

	const fullText = extractFullText(events);
	console.log(
		`✓ Agent response (${fullText.length} chars):\n--- BEGIN RESPONSE ---\n${fullText}\n--- END RESPONSE ---`,
	);
	const citationMatches = fullText.match(/\[c\d+\]:\s*\S+/g);
	if (citationMatches) {
		console.log(`✓ Found ${citationMatches.length} citation(s):`);
		for (const c of citationMatches) console.log(`    ${c}`);
	} else {
		console.log("⚠ No citation footer found in response");
	}

	// Verify the filesystem is materialized for this member.
	const lsResult = await sandbox.commands.run(
		`find ${WORKSPACE_ROOT}/data -name '*.md' -type f 2>/dev/null | wc -l`,
		{ timeoutMs: 10_000 },
	);
	const fileCount = Number(lsResult.stdout.trim());
	console.log(`Materialized .md files: ${fileCount}`);
	assert.ok(
		fileCount > 0,
		"Should have materialized at least one .md file after reconciliation",
	);

	// Sanity-check _index.md exists and is non-trivial.
	const indexSize = await sandbox.commands.run(
		`wc -c < ${WORKSPACE_ROOT}/data/*/canonical/_index.md 2>/dev/null`,
		{ timeoutMs: 5_000 },
	);
	console.log(`_index.md size: ${indexSize.stdout.trim()} bytes`);
	assert.ok(
		Number(indexSize.stdout.trim()) > 20,
		"_index.md should be non-trivial",
	);
}

async function waitForIdle() {
	for (let i = 0; i < 30; i++) {
		const res = await fetch(`${daemonUrl}/current`);
		const state = (await res.json()) as { busy: boolean };
		if (!state.busy) return;
		await new Promise((r) => setTimeout(r, 1_000));
	}
}

async function testSyncSkip() {
	console.log("\n=== Test 5: Sync Skip (nothing changed) ===");
	await waitForIdle();

	const start = performance.now();
	const turnBody = {
		request_id: `turn-skip-${Date.now()}`,
		user_id: userId,
		scope_type: "global",
		message: "Say hello",
		system_prompt: "You are helpful. Just say hello.",
	};

	const res = await fetch(`${daemonUrl}/turn`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(turnBody),
		signal: AbortSignal.timeout(120_000),
	});
	const elapsed = performance.now() - start;

	assert.equal(res.status, 200);
	console.log(`✓ Turn with sync-skip completed in ${elapsed.toFixed(0)}ms`);
}

async function testConcurrentTurnRejection() {
	console.log("\n=== Test 6: Concurrent Turn Rejection ===");
	await waitForIdle();

	const longTurnBody = {
		request_id: `turn-long-${Date.now()}`,
		user_id: userId,
		scope_type: "global",
		message: "Write a detailed essay about computing history.",
		system_prompt: "You are helpful. Write a long response.",
	};

	const longTurnPromise = fetch(`${daemonUrl}/turn`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(longTurnBody),
		signal: AbortSignal.timeout(120_000),
	});

	await new Promise((r) => setTimeout(r, 500));

	const res2 = await fetch(`${daemonUrl}/turn`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			...longTurnBody,
			request_id: `turn-blocked-${Date.now()}`,
		}),
	});

	assert.equal(res2.status, 409);
	console.log("✓ Concurrent turn correctly rejected with 409");

	// Drain the long turn's body so the streaming lock is fully released
	// before the next test starts.
	const longRes = await longTurnPromise;
	await longRes.text();
}

function parseEvents(text: string): Array<Record<string, unknown>> {
	return text
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => {
			try {
				return JSON.parse(line);
			} catch {
				return null;
			}
		})
		.filter(Boolean);
}

async function sendTurn(
	body: Record<string, unknown>,
): Promise<{ status: number; events: Array<Record<string, unknown>> }> {
	await waitForIdle();
	const res = await fetch(`${daemonUrl}/turn`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(180_000),
	});
	const text = await res.text();
	return { status: res.status, events: parseEvents(text) };
}

async function testCollectionScope() {
	console.log("\n=== Test 7: Collection Scope ===");
	assert.ok(fixtures, "fixtures must be discovered before Test 7");

	const { status, events } = await sendTurn({
		request_id: `turn-col-${Date.now()}`,
		user_id: userId,
		scope_type: "collection",
		collection_id: fixtures.collectionId,
		message: "Name one document in this collection.",
		system_prompt: prodPrompt("collection", {
			collectionId: fixtures.collectionId,
		}),
	});

	assert.equal(status, 200);
	const types = events.map((e) => e.type);
	console.log(`Event types: ${types.join(", ")}`);
	assert.ok(types.includes("text_delta"), "Should have text_delta events");

	const fullText = extractFullText(events);
	console.log(
		`✓ Collection-scope response (${fullText.length} chars): "${fullText.slice(0, 300)}"`,
	);
}

async function testDocumentScope() {
	console.log("\n=== Test 8: Document Scope ===");
	assert.ok(fixtures, "fixtures must be discovered before Test 8");

	const { status, events } = await sendTurn({
		request_id: `turn-doc-${Date.now()}`,
		user_id: userId,
		scope_type: "document",
		summary_id: fixtures.docIdInCollection,
		message: "Summarize this document in one sentence.",
		system_prompt: prodPrompt("document", {
			summaryId: fixtures.docIdInCollection,
		}),
	});

	assert.equal(status, 200);
	const types = events.map((e) => e.type);
	console.log(`Event types: ${types.join(", ")}`);
	assert.ok(types.includes("text_delta"), "Should have text_delta events");

	const fullText = extractFullText(events);
	console.log(
		`✓ Document-scope response (${fullText.length} chars): "${fullText.slice(0, 300)}"`,
	);
}

async function testMissingScopeId() {
	console.log("\n=== Test 9: Missing Scope ID ===");

	const { status, events } = await sendTurn({
		request_id: `turn-no-col-${Date.now()}`,
		user_id: userId,
		scope_type: "collection",
		// no collection_id
		message: "hello",
		system_prompt: "hi",
	});

	assert.equal(status, 200);
	const failedEvent = events.find((e) => e.type === "failed");
	assert.ok(failedEvent, "Should have a failed event");
	assert.ok(
		String(failedEvent.message).includes("collection_id required"),
		`Failed message should mention collection_id, got: ${failedEvent.message}`,
	);
	console.log("✓ Missing collection_id correctly rejected");
}

async function testMissingDocument() {
	console.log("\n=== Test 10: Missing Document ===");

	const { status, events } = await sendTurn({
		request_id: `turn-no-doc-${Date.now()}`,
		user_id: userId,
		scope_type: "document",
		summary_id: "nonexistent-doc-id-integration-test",
		message: "hello",
		system_prompt: "hi",
	});

	assert.equal(status, 200);
	const failedEvent = events.find((e) => e.type === "failed");
	assert.ok(failedEvent, "Should have a failed event");
	assert.ok(
		String(failedEvent.message).includes("not found"),
		`Failed message should mention not found, got: ${failedEvent.message}`,
	);
	console.log("✓ Missing document correctly rejected");
}

async function testSandboxIdPersistence() {
	console.log("\n=== Test 11: Sandbox ID Persisted in Postgres ===");

	const runtime = await getRuntime(userId);
	assert.ok(runtime, "Runtime row should exist in Postgres");
	assert.equal(
		runtime.sandbox_id,
		sandbox.sandboxId,
		"Runtime.sandbox_id should match the live sandbox",
	);
	console.log(`✓ sandbox_id persisted: ${runtime.sandbox_id}`);

	// Fresh SandboxManager should reconnect via Postgres lookup.
	const freshManager = new SandboxManager();
	const reconnected = await freshManager.getOrCreateSandbox(userId, logger);
	assert.equal(
		reconnected.sandboxId,
		sandbox.sandboxId,
		"Fresh manager should reconnect to the same sandbox via Postgres lookup",
	);
	console.log(
		"✓ Fresh SandboxManager reconnected via Postgres (no Sandbox.list)",
	);
}

async function cleanup() {
	console.log("\n=== Cleanup ===");
	try {
		await cleanupDaemonState();
		console.log("✓ Daemon runtime/session state cleared");
	} catch (err) {
		console.error("Failed to clean daemon state:", err);
	}
	try {
		if (sandbox) {
			await sandboxManager.killSandbox(userId, sandbox, logger);
			console.log("✓ Sandbox killed");
		}
	} catch (err) {
		console.error("Failed to kill sandbox:", err);
	}
	await closeDb();
}

async function main() {
	try {
		// Clear any stale daemon state from a previous run for this member,
		// so the test starts from a clean slate without Sandbox.connect races.
		await cleanupDaemonState();

		fixtures = await discoverFixtures();
		await setup();
		await testDaemonDeployment();
		await testCurrentEndpoint();
		await testIdempotentDeploy();
		await testReconciliationAndTurn();
		await testSyncSkip();
		await testConcurrentTurnRejection();
		await testCollectionScope();
		await testDocumentScope();
		await testMissingScopeId();
		await testMissingDocument();
		await testSandboxIdPersistence();
		console.log("\n✓ All E2B daemon integration tests passed");
	} catch (err) {
		console.error("\n✗ Test failed:", err);
		process.exitCode = 1;
	} finally {
		await cleanup();
	}
}

main();
