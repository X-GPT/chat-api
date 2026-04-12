/**
 * E2B integration test for the sandbox daemon.
 *
 * Tests: deploy daemon → health check → DB reconciliation → turn execution → session persistence.
 *
 * Usage:
 *   bun run scripts/run-daemon-e2b-integration.ts
 *
 * Requires: E2B_API_KEY, ANTHROPIC_API_KEY, DATABASE_URL (via env or .env)
 */

import assert from "node:assert/strict";
import { userFiles, userSandboxRuntime, userSandboxSessions } from "@mymemo/db";
import { eq } from "drizzle-orm";
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

const userId = `e2b-test-${Date.now()}`;
let sandbox: Sandbox;
let daemonUrl: string;
const sandboxManager = new SandboxManager();
const db = getDb();

/**
 * Build the same production system prompt the live daemon would send.
 * Tests 4 / 7 / 8 use this so any prompt-level regression (citation format,
 * retrieval strategy, rules) fails the integration test loudly.
 */
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

async function seedTestData() {
	console.log("=== Seeding test data ===");

	await db.insert(userFiles).values([
		{
			userId,
			documentId: "doc-1",
			type: 0,
			pathKey: "col-test",
			content:
				"The capital of France is Paris. It is known for the Eiffel Tower.",
			checksum: "checksum-doc-1",
		},
		{
			userId,
			documentId: "doc-2",
			type: 3,
			pathKey: "",
			content: "Buy milk, eggs, and bread from the store.",
			checksum: "checksum-doc-2",
		},
	]);

	console.log("✓ Seeded 2 documents");
}

async function cleanupTestData() {
	await Promise.all([
		db.delete(userFiles).where(eq(userFiles.userId, userId)),
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
	const url2 = await sandboxManager.ensureSandboxDaemon(
		userId,
		sandbox,
		logger,
	);
	const elapsed = performance.now() - start;

	assert.equal(url2, daemonUrl);
	console.log(`✓ Idempotent deploy took ${elapsed.toFixed(0)}ms`);
}

async function dumpSandboxDiagnostics() {
	console.log("\n--- Sandbox Diagnostics ---");
	try {
		const healthRes = await fetch(`${daemonUrl}/health`).catch(() => null);
		console.log(`Daemon health: ${healthRes?.status ?? "unreachable"}`);
	} catch {}
	try {
		const psResult = await sandbox.commands.run(
			"ps aux --sort=-%mem 2>/dev/null | head -10 || ps aux | head -10",
			{ timeoutMs: 5_000 },
		);
		console.log(`Processes:\n${psResult.stdout}`);
	} catch {}
	try {
		const memResult = await sandbox.commands.run(
			"cat /proc/meminfo 2>/dev/null | head -5",
			{ timeoutMs: 5_000 },
		);
		console.log(`Memory:\n${memResult.stdout}`);
	} catch {}
	try {
		const dmesgResult = await sandbox.commands.run(
			"dmesg 2>/dev/null | grep -i -E 'oom|kill|out of memory' | tail -20 || echo '(no dmesg access)'",
			{ timeoutMs: 5_000 },
		);
		console.log(`OOM logs: ${dmesgResult.stdout.trim()}`);
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
	console.log("\n=== Test 4: Reconciliation + Turn Execution ===");

	const turnBody = {
		request_id: `turn-${Date.now()}`,
		user_id: userId,
		scope_type: "global",
		message: "What is the capital of France?",
		system_prompt: prodPrompt("general"),
	};

	let res: Response;
	try {
		res = await fetch(`${daemonUrl}/turn`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(turnBody),
			signal: AbortSignal.timeout(120_000),
		});
	} catch (err) {
		console.log(
			`Turn request failed: ${err instanceof Error ? err.message : err}`,
		);
		await dumpSandboxDiagnostics();
		throw err;
	}

	assert.equal(res.status, 200, `Turn should return 200, got ${res.status}`);
	const text = await res.text();

	const events = text
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

	const types = events.map((e: { type: string }) => e.type);
	console.log(`Event types: ${types.join(", ")}`);

	if (!types.includes("completed") && !types.includes("text_delta")) {
		console.log("⚠ Agent produced no output");
		console.log(`Raw response:\n${text}`);
		await dumpSandboxDiagnostics();
	}

	assert.ok(types.includes("started"), "Should have started event");
	assert.ok(types.includes("text_delta"), "Should have text_delta events");

	const fullText = extractFullText(events);
	console.log(
		`✓ Agent response (${fullText.length} chars): "${fullText.slice(0, 200)}..."`,
	);

	// doc-1 (type 0) holds the France answer. With the production prompt,
	// the agent must find it via Grep and cite it as `detail/0/doc-1` per
	// sandbox-agent.prompt.ts citation rules. If either the filesystem layout
	// OR the production prompt regresses, this assertion fails loudly.
	assert.ok(
		/Paris/i.test(fullText),
		`Expected answer to mention Paris:\n${fullText.slice(0, 400)}`,
	);
	assert.match(
		fullText,
		/\[c\d+\]:\s*detail\/0\/doc-1/,
		`Expected citation [cN]: detail/0/doc-1 in response:\n${fullText.slice(0, 400)}`,
	);
	console.log("✓ Response contains correct citation for detail/0/doc-1");

	if (types.includes("session_id")) {
		const sessionEvent = events.find(
			(e: { type: string }) => e.type === "session_id",
		);
		console.log(`✓ Session ID: ${sessionEvent.sessionId}`);
	}

	if (types.includes("completed")) {
		console.log("✓ Turn completed successfully");
	} else if (types.includes("failed")) {
		const failedEvent = events.find(
			(e: { type: string }) => e.type === "failed",
		);
		console.log(`⚠ Turn failed: ${failedEvent.message}`);
	}

	// Verify reconciliation happened — check that files exist on sandbox FS
	const lsResult = await sandbox.commands.run(
		`find ${WORKSPACE_ROOT}/data -name '*.md' -type f 2>/dev/null | head -20`,
		{ timeoutMs: 5_000 },
	);
	console.log(`Files on sandbox after reconciliation:\n${lsResult.stdout}`);
	assert.ok(
		lsResult.stdout.includes(".md"),
		"Should have .md files after reconciliation",
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
	console.log("\n=== Test 5: Sync Skip (same version) ===");
	await waitForIdle();

	// Second turn with same version should skip reconciliation
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

	await longTurnPromise;
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
		signal: AbortSignal.timeout(120_000),
	});
	const text = await res.text();
	return { status: res.status, events: parseEvents(text) };
}

async function testCollectionScope() {
	console.log("\n=== Test 7: Collection Scope ===");

	const { status, events } = await sendTurn({
		request_id: `turn-col-${Date.now()}`,
		user_id: userId,
		scope_type: "collection",
		collection_id: "col-test",
		message: "What is the capital of France?",
		system_prompt: prodPrompt("collection", { collectionId: "col-test" }),
	});

	assert.equal(status, 200);
	const types = events.map((e) => e.type);
	console.log(`Event types: ${types.join(", ")}`);
	assert.ok(types.includes("text_delta"), "Should have text_delta events");

	const fullText = extractFullText(events);
	console.log(
		`✓ Agent response (${fullText.length} chars): "${fullText.slice(0, 200)}..."`,
	);

	// doc-1 is in col-test and holds the France answer. Production prompt
	// citation for type 0 is detail/0/doc-1.
	assert.ok(
		/Paris/i.test(fullText),
		`Expected collection-scope answer to mention Paris:\n${fullText.slice(0, 400)}`,
	);
	assert.match(
		fullText,
		/\[c\d+\]:\s*detail\/0\/doc-1/,
		`Expected citation [cN]: detail/0/doc-1 in collection-scope response:\n${fullText.slice(0, 400)}`,
	);
	console.log("✓ Collection scope turn completed with correct citation");
}

async function testDocumentScope() {
	console.log("\n=== Test 8: Document Scope ===");

	const { status, events } = await sendTurn({
		request_id: `turn-doc-${Date.now()}`,
		user_id: userId,
		scope_type: "document",
		summary_id: "doc-2",
		message: "What should I buy?",
		system_prompt: prodPrompt("document", { summaryId: "doc-2" }),
	});

	assert.equal(status, 200);
	const types = events.map((e) => e.type);
	console.log(`Event types: ${types.join(", ")}`);
	assert.ok(types.includes("text_delta"), "Should have text_delta events");

	const fullText = extractFullText(events);
	console.log(
		`✓ Agent response (${fullText.length} chars): "${fullText.slice(0, 200)}..."`,
	);

	// doc-2 (type 3) is the shopping list. Production prompt citation for
	// type 3 is notes/3/{summaryId}. Answer should mention at least one of
	// the items (milk/eggs/bread).
	assert.ok(
		/milk|eggs|bread/i.test(fullText),
		`Expected document-scope answer to mention shopping items:\n${fullText.slice(0, 400)}`,
	);
	assert.match(
		fullText,
		/\[c\d+\]:\s*notes\/3\/doc-2/,
		`Expected citation [cN]: notes/3/doc-2 in document-scope response:\n${fullText.slice(0, 400)}`,
	);
	console.log("✓ Document scope turn completed with correct citation");
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
		summary_id: "nonexistent-doc",
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
	console.log("\n=== Test 11: Sandbox ID Persistence in Postgres ===");

	const runtime = await getRuntime(userId);
	const persistedId = runtime?.sandbox_id;
	assert.ok(persistedId, "sandbox_id should be persisted in Postgres");
	assert.equal(
		persistedId,
		sandbox.sandboxId,
		"Persisted sandbox_id should match the active sandbox",
	);
	console.log(`✓ sandbox_id persisted: ${persistedId}`);

	// A fresh SandboxManager (no in-memory state) should reconnect via Postgres
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
		await cleanupTestData();
		console.log("✓ Test data cleaned from Postgres");
	} catch (err) {
		console.error("Failed to clean test data:", err);
	}
	try {
		await sandboxManager.killSandbox(userId, sandbox, logger);
		console.log("✓ Sandbox killed");
	} catch (err) {
		console.error("Failed to kill sandbox:", err);
	}
	await closeDb();
}

async function main() {
	try {
		await seedTestData();
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
