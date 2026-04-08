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
import { Pool } from "pg";
import type { Sandbox } from "e2b";
import type { SyncLogger } from "@/features/sandbox";
import { apiEnv } from "@/config/env";
import {
	SandboxManager,
	WORKSPACE_ROOT,
} from "@/features/sandbox-orchestration/sandbox-manager";

const DATABASE_URL = apiEnv.DATABASE_URL;
if (!DATABASE_URL) {
	console.error("DATABASE_URL is required for this integration test");
	process.exit(1);
}

const logger: SyncLogger = {
	info: (obj) => console.log("[INFO]", JSON.stringify(obj)),
	error: (obj) => console.error("[ERROR]", JSON.stringify(obj)),
};

const userId = `e2b-test-${Date.now()}`;
let sandbox: Sandbox;
let daemonUrl: string;
const sandboxManager = new SandboxManager();
const pool = new Pool({ connectionString: DATABASE_URL });

async function seedTestData() {
	console.log("=== Seeding test data in Postgres ===");

	// Insert test files
	await pool.query(
		`INSERT INTO user_files (user_id, document_id, type, slug, path_key, content, checksum)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[
			userId,
			"doc-1",
			0,
			"france-capital",
			"",
			"The capital of France is Paris. It is known for the Eiffel Tower.",
			"checksum-doc-1",
		],
	);

	await pool.query(
		`INSERT INTO user_files (user_id, document_id, type, slug, path_key, content, checksum)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[
			userId,
			"doc-2",
			3,
			"shopping-list",
			"",
			"Buy milk, eggs, and bread from the store.",
			"checksum-doc-2",
		],
	);

	// Verify state_version was bumped by the trigger
	const result = await pool.query(
		"SELECT state_version FROM user_sandbox_runtime WHERE user_id = $1",
		[userId],
	);
	const stateVersion = result.rows[0]?.state_version ?? 0;
	console.log(`✓ Seeded 2 documents, state_version=${stateVersion}`);
	assert.ok(stateVersion >= 2, "state_version should be >= 2 after 2 inserts");

	return stateVersion;
}

async function cleanupTestData() {
	await pool.query("DELETE FROM user_files WHERE user_id = $1", [userId]);
	await pool.query("DELETE FROM user_sandbox_runtime WHERE user_id = $1", [
		userId,
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

async function testReconciliationAndTurn(stateVersion: number) {
	console.log("\n=== Test 4: Reconciliation + Turn Execution ===");

	const turnBody = {
		request_id: `turn-${Date.now()}`,
		user_id: userId,
		required_version: stateVersion,
		scope_type: "global",
		message: "What is the capital of France?",
		system_prompt: [
			"You are a helpful assistant.",
			"Search for and read .md files in your working directory to answer questions.",
			"Use Grep and Read tools to find information.",
		].join(" "),
	};

	const res = await fetch(`${daemonUrl}/turn`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(turnBody),
		signal: AbortSignal.timeout(120_000),
	});

	assert.equal(res.status, 200, "Turn should return 200");
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

	assert.ok(types.includes("started"), "Should have started event");

	if (types.includes("text_delta")) {
		const fullText = events
			.filter((e: { type: string }) => e.type === "text_delta")
			.map((e: { text: string }) => e.text)
			.join("");
		console.log(
			`✓ Agent response (${fullText.length} chars): "${fullText.slice(0, 120)}..."`,
		);
	}

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

async function testSyncSkip() {
	console.log("\n=== Test 5: Sync Skip (same version) ===");

	// Second turn with same version should skip reconciliation
	const start = performance.now();
	const turnBody = {
		request_id: `turn-skip-${Date.now()}`,
		user_id: userId,
		required_version: 0, // version 0 <= local synced version → skip
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
		required_version: 0,
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
	await pool.end();
}

async function main() {
	try {
		const stateVersion = await seedTestData();
		await setup();
		await testDaemonDeployment();
		await testCurrentEndpoint();
		await testIdempotentDeploy();
		await testReconciliationAndTurn(stateVersion);
		await testSyncSkip();
		await testConcurrentTurnRejection();
		console.log("\n✓ All E2B daemon integration tests passed");
	} catch (err) {
		console.error("\n✗ Test failed:", err);
		process.exitCode = 1;
	} finally {
		await cleanup();
	}
}

main();
