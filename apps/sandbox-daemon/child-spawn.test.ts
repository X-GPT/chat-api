/**
 * Real-subprocess timeout tests for spawnSync / spawnAgent. We write tiny
 * fixture scripts to a tmpdir and point the env-overridable paths at them,
 * so we exercise the actual Bun.spawn + NDJSON + watchdog wiring rather
 * than mocking it.
 */

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentEvent, spawnAgent, spawnSync } from "./child-spawn";

let tmpDir: string;
const fixtures: Record<string, string> = {};

beforeAll(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "child-spawn-"));

	// Sync that never exits.
	fixtures.syncHang = join(tmpDir, "sync-hang.ts");
	writeFileSync(fixtures.syncHang, `await new Promise(() => {});\n`);

	// Sync that emits a synced event and exits 0.
	fixtures.syncOk = join(tmpDir, "sync-ok.ts");
	writeFileSync(
		fixtures.syncOk,
		`process.stdout.write(JSON.stringify({ type: "synced", changed: false, dataRoot: "/tmp" }) + "\\n");\nprocess.exit(0);\n`,
	);

	// Agent that consumes stdin then hangs (idle forever).
	fixtures.agentHang = join(tmpDir, "agent-hang.ts");
	writeFileSync(
		fixtures.agentHang,
		`for await (const _ of process.stdin) {}\nawait new Promise(() => {});\n`,
	);

	// Agent that emits 5 text_delta events 80ms apart, then completes.
	// Total wall-clock ~400ms; max gap ~80ms — survives any idle threshold > 80ms.
	fixtures.agentSlow = join(tmpDir, "agent-slow.ts");
	writeFileSync(
		fixtures.agentSlow,
		`for await (const _ of process.stdin) {}\nfor (let i = 0; i < 5; i++) {\n  process.stdout.write(JSON.stringify({ type: "text_delta", text: "tick" }) + "\\n");\n  await new Promise((r) => setTimeout(r, 80));\n}\nprocess.stdout.write(JSON.stringify({ type: "completed" }) + "\\n");\nprocess.exit(0);\n`,
	);
});

afterAll(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

const TIMEOUT_ENV_VARS = [
	"SANDBOX_SYNC_PATH",
	"SANDBOX_AGENT_PATH",
	"SANDBOX_SYNC_TIMEOUT_MS",
	"SANDBOX_AGENT_IDLE_TIMEOUT_MS",
];

beforeEach(() => {
	for (const key of TIMEOUT_ENV_VARS) delete process.env[key];
});
afterEach(() => {
	for (const key of TIMEOUT_ENV_VARS) delete process.env[key];
});

describe("spawnSync wall-clock timeout", () => {
	it("returns failed when child exceeds timeout", async () => {
		process.env.SANDBOX_SYNC_PATH = fixtures.syncHang;
		process.env.SANDBOX_SYNC_TIMEOUT_MS = "200";

		const start = Date.now();
		const result = await spawnSync({ userId: "u1" });
		const elapsed = Date.now() - start;

		expect(result.type).toBe("failed");
		if (result.type === "failed") {
			expect(result.message).toContain("timed out");
			expect(result.message).toContain("200");
		}
		// 200ms timeout + spawn/teardown overhead. Cap at 5s to catch hangs.
		expect(elapsed).toBeLessThan(5_000);
	});

	it("succeeds when child finishes within timeout", async () => {
		process.env.SANDBOX_SYNC_PATH = fixtures.syncOk;
		process.env.SANDBOX_SYNC_TIMEOUT_MS = "10000";

		const result = await spawnSync({ userId: "u1" });

		expect(result.type).toBe("synced");
		if (result.type === "synced") {
			expect(result.dataRoot).toBe("/tmp");
		}
	});
});

describe("spawnAgent idle timeout", () => {
	function makeInput(onEvent: (e: AgentEvent) => void) {
		return {
			userQuery: "test",
			systemPrompt: "test",
			cwd: "/tmp",
			onEvent,
		};
	}

	it("kills child and emits failed when no events arrive", async () => {
		process.env.SANDBOX_AGENT_PATH = fixtures.agentHang;
		process.env.SANDBOX_AGENT_IDLE_TIMEOUT_MS = "200";

		const events: AgentEvent[] = [];
		const start = Date.now();
		await spawnAgent(makeInput((e) => events.push(e)));
		const elapsed = Date.now() - start;

		expect(elapsed).toBeLessThan(5_000);
		const failed = events.find((e) => e.type === "failed");
		expect(failed).toBeDefined();
		if (failed?.type === "failed") {
			expect(failed.message).toContain("idle timeout");
			expect(failed.message).toContain("200");
		}
	});

	it("does not fire while events keep arriving (timer resets)", async () => {
		process.env.SANDBOX_AGENT_PATH = fixtures.agentSlow;
		// 300ms idle window; child emits every 80ms — well under threshold.
		process.env.SANDBOX_AGENT_IDLE_TIMEOUT_MS = "300";

		const events: AgentEvent[] = [];
		const result = await spawnAgent(makeInput((e) => events.push(e)));

		expect(result.exitCode).toBe(0);
		expect(events.find((e) => e.type === "failed")).toBeUndefined();
		const deltas = events.filter((e) => e.type === "text_delta");
		expect(deltas.length).toBe(5);
	});
});
