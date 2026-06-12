import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	spyOn,
} from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "./child-spawn";
import { buildAgentSpawnArgv, spawnAgent } from "./child-spawn";

describe("buildAgentSpawnArgv", () => {
	it("wraps bun /workspace/agent.js with bwrap and the agreed flags", () => {
		const argv = buildAgentSpawnArgv("/workspace/data/u1/canonical");

		expect(argv[0]).toBe("bwrap");

		const dashDash = argv.indexOf("--");
		expect(dashDash).toBeGreaterThan(0);
		expect(argv.slice(dashDash)).toEqual(["--", "bun", "/workspace/agent.js"]);

		const flags = argv.slice(1, dashDash);
		// FS layout
		expect(flags).toContain("--ro-bind");
		expect(flags).toContain("--bind");
		expect(flags).toContain("/workspace/data/u1/canonical");
		expect(flags).toContain("--tmpfs");
		expect(flags).toContain("/tmp");
		expect(flags).toContain("--proc");
		expect(flags).toContain("--dev");
		// Namespaces — note `--unshare-net` is intentionally absent so the
		// agent can reach the LLM gateway over HTTPS.
		expect(flags).toContain("--unshare-user");
		expect(flags).toContain("--unshare-pid");
		expect(flags).toContain("--unshare-uts");
		expect(flags).toContain("--unshare-ipc");
		expect(flags).not.toContain("--unshare-net");
		expect(flags).not.toContain("--unshare-all");
		// Lifetime: bwrap + agent should die if the daemon goes away.
		expect(flags).toContain("--die-with-parent");
	});

	it("masks /workspace, then re-binds only the agent bundle and selected scope", () => {
		const cwd = "/workspace/data/u2/scopes/request-doc-42";
		const argv = buildAgentSpawnArgv(cwd);

		const roRootIdx = argv.findIndex(
			(a, i) => a === "--ro-bind" && argv[i + 1] === "/" && argv[i + 2] === "/",
		);
		const tmpfsWorkspaceIdx = argv.findIndex(
			(a, i) => a === "--tmpfs" && argv[i + 1] === "/workspace",
		);
		const roAgentIdx = argv.findIndex(
			(a, i) =>
				a === "--ro-bind" &&
				argv[i + 1] === "/workspace/agent.js" &&
				argv[i + 2] === "/workspace/agent.js",
		);
		const bindCwdIdx = argv.findIndex(
			(a, i) => a === "--bind" && argv[i + 1] === cwd && argv[i + 2] === cwd,
		);

		expect(roRootIdx).toBeGreaterThan(-1);
		expect(tmpfsWorkspaceIdx).toBeGreaterThan(-1);
		expect(roAgentIdx).toBeGreaterThan(-1);
		expect(bindCwdIdx).toBeGreaterThan(-1);

		// Ordering matters: later mounts shadow earlier ones for the same
		// subtree. Required order:
		//   1. --ro-bind / /             (everything visible)
		//   2. --tmpfs /workspace        (masks daemon.log, daemon.js, sync.js
		//                                 AND every user's data tree)
		//   3. --ro-bind agent.js        (re-expose only the bundle bun runs)
		//   4. --bind <cwd>              (re-expose only the selected scope)
		expect(roRootIdx).toBeLessThan(tmpfsWorkspaceIdx);
		expect(tmpfsWorkspaceIdx).toBeLessThan(roAgentIdx);
		expect(tmpfsWorkspaceIdx).toBeLessThan(bindCwdIdx);
	});

	it("re-binds ~/.claude/projects rw so the Claude SDK can persist sessions", () => {
		// Claude Agent SDK writes session transcripts under ~/.claude/projects;
		// with --ro-bind / / that path would be read-only and both the
		// first-turn write and resume on subsequent turns would silently
		// fail. Pin that we re-bind it rw.
		const argv = buildAgentSpawnArgv("/workspace/data/u1/canonical");
		const projectsDir = `${Bun.env.HOME ?? "/home/user"}/.claude/projects`;
		const idx = argv.findIndex(
			(a, i) =>
				a === "--bind" &&
				argv[i + 1] === projectsDir &&
				argv[i + 2] === projectsDir,
		);
		expect(idx).toBeGreaterThan(-1);
	});

	it("does not expose /workspace/daemon.log, daemon.js, or sync.js", () => {
		const argv = buildAgentSpawnArgv("/workspace/data/u1/canonical");
		// None of these paths should appear anywhere in the argv — they are
		// covered by the --tmpfs /workspace and never re-bound.
		expect(argv).not.toContain("/workspace/daemon.js");
		expect(argv).not.toContain("/workspace/sync.js");
		expect(argv).not.toContain("/workspace/daemon.log");
	});

	it("respects SANDBOX_BWRAP_PATH and SANDBOX_BUN_PATH env overrides", () => {
		const original = {
			bwrap: process.env.SANDBOX_BWRAP_PATH,
			bun: process.env.SANDBOX_BUN_PATH,
			agent: process.env.SANDBOX_AGENT_PATH,
		};
		process.env.SANDBOX_BWRAP_PATH = "/custom/bwrap";
		process.env.SANDBOX_BUN_PATH = "/custom/bun";
		process.env.SANDBOX_AGENT_PATH = "/custom/agent.js";
		try {
			const argv = buildAgentSpawnArgv("/tmp/cwd");
			expect(argv[0]).toBe("/custom/bwrap");
			expect(argv.slice(-2)).toEqual(["/custom/bun", "/custom/agent.js"]);
		} finally {
			process.env.SANDBOX_BWRAP_PATH = original.bwrap;
			process.env.SANDBOX_BUN_PATH = original.bun;
			process.env.SANDBOX_AGENT_PATH = original.agent;
		}
	});
});

describe("spawnAgent agent environment", () => {
	let spawnSpy: ReturnType<typeof spyOn> | undefined;
	let originalHome: string | undefined;

	afterEach(() => {
		spawnSpy?.mockRestore();
		if (originalHome === undefined) delete Bun.env.HOME;
		else Bun.env.HOME = originalHome;
	});

	function fakeProc() {
		return {
			stdin: { write: () => {}, end: () => Promise.resolve() },
			stdout: new ReadableStream<Uint8Array>({
				start(controller) {
					controller.close();
				},
			}),
			stderr: new ReadableStream<Uint8Array>({
				start(controller) {
					controller.close();
				},
			}),
			exited: Promise.resolve(0),
		};
	}

	it("passes the gateway base url + bearer token and never a provider key", async () => {
		// Keep ensureClaudeProjectsDir's mkdir inside a temp HOME.
		originalHome = Bun.env.HOME;
		Bun.env.HOME = join(tmpdir(), `spawn-agent-${Date.now()}`);

		spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
			fakeProc() as unknown as ReturnType<typeof Bun.spawn>,
		);

		await spawnAgent({
			userQuery: "q",
			systemPrompt: "s",
			cwd: "/workspace/data/u1/canonical",
			llmBaseUrl: "https://gateway.example",
			llmToken: "tok-123",
			onEvent: async () => {},
		});

		const call = spawnSpy.mock.calls[0] as [
			string[],
			{ env: Record<string, string> },
		];
		const env = call[1].env;
		expect(env.ANTHROPIC_BASE_URL).toBe("https://gateway.example");
		expect(env.ANTHROPIC_AUTH_TOKEN).toBe("tok-123");
		// The whole point of the gateway: no provider key reaches the agent.
		expect("ANTHROPIC_API_KEY" in env).toBe(false);
	});
});

describe("spawnAgent idle timeout", () => {
	// Real-subprocess tests: tiny fixture scripts stand in for agent.js, and a
	// shim replaces bwrap (absent on dev machines) — it drops the bwrap flags
	// and execs the command after `--`, so we exercise the actual Bun.spawn +
	// NDJSON + watchdog wiring rather than mocking it.
	let tmpDir: string;
	const fixtures: Record<string, string> = {};
	let originalHome: string | undefined;

	const ENV_VARS = [
		"SANDBOX_BWRAP_PATH",
		"SANDBOX_AGENT_PATH",
		"SANDBOX_AGENT_IDLE_TIMEOUT_MS",
	];
	const originalEnv: Record<string, string | undefined> = {};

	beforeAll(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "child-spawn-"));

		// Keep ensureClaudeProjectsDir's mkdir inside the temp dir.
		originalHome = Bun.env.HOME;
		Bun.env.HOME = tmpDir;

		fixtures.bwrapShim = join(tmpDir, "bwrap-shim.sh");
		writeFileSync(
			fixtures.bwrapShim,
			`#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n`,
		);
		chmodSync(fixtures.bwrapShim, 0o755);

		// Agent that consumes stdin then hangs (idle forever).
		fixtures.agentHang = join(tmpDir, "agent-hang.ts");
		writeFileSync(
			fixtures.agentHang,
			`for await (const _ of process.stdin) {}\nawait new Promise(() => {});\n`,
		);

		// Agent that emits 6 text_delta events 500ms apart, then completes.
		// Total span ~2.5s exceeds the 2s idle window used in the test, so it
		// only survives if every event re-arms the timer; the 500ms gaps stay
		// far below the window.
		fixtures.agentSlow = join(tmpDir, "agent-slow.ts");
		writeFileSync(
			fixtures.agentSlow,
			`for await (const _ of process.stdin) {}\nfor (let i = 0; i < 6; i++) {\n  process.stdout.write(JSON.stringify({ type: "text_delta", text: "tick" }) + "\\n");\n  await new Promise((r) => setTimeout(r, 500));\n}\nprocess.stdout.write(JSON.stringify({ type: "completed" }) + "\\n");\nprocess.exit(0);\n`,
		);

		// Agent that emits completed, closes stdout, then lingers forever —
		// reproduces the teardown race: the read loop ends but the process
		// never exits, so only the still-armed watchdog unblocks the wait.
		fixtures.agentLinger = join(tmpDir, "agent-linger.ts");
		writeFileSync(
			fixtures.agentLinger,
			`import { closeSync } from "node:fs";\nfor await (const _ of process.stdin) {}\nprocess.stdout.write(JSON.stringify({ type: "completed" }) + "\\n");\nawait new Promise((r) => setTimeout(r, 50));\ncloseSync(1);\nawait new Promise(() => {});\n`,
		);

		for (const key of ENV_VARS) originalEnv[key] = process.env[key];
		process.env.SANDBOX_BWRAP_PATH = fixtures.bwrapShim;
	});

	afterAll(() => {
		for (const key of ENV_VARS) {
			if (originalEnv[key] === undefined) delete process.env[key];
			else process.env[key] = originalEnv[key];
		}
		if (originalHome === undefined) delete Bun.env.HOME;
		else Bun.env.HOME = originalHome;
		rmSync(tmpDir, { recursive: true, force: true });
	});

	function makeInput(onEvent: (e: AgentEvent) => void) {
		return {
			userQuery: "test",
			systemPrompt: "test",
			cwd: tmpDir,
			llmBaseUrl: "https://gateway.example",
			docGatewayUrl: "https://docs.example",
			llmToken: "tok-test",
			onEvent,
		};
	}

	it("kills the child and emits failed when no events arrive", async () => {
		process.env.SANDBOX_AGENT_PATH = fixtures.agentHang;
		process.env.SANDBOX_AGENT_IDLE_TIMEOUT_MS = "200";

		const events: AgentEvent[] = [];
		const start = Date.now();
		await spawnAgent(makeInput((e) => events.push(e)));
		const elapsed = Date.now() - start;

		// 200ms timeout + spawn/teardown overhead. Cap at 5s to catch hangs.
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
		// 2s idle window: generous enough to absorb bun's cold start (~900ms
		// observed) before the first event, while the fixture's ~2.5s total
		// span exceeds it — so passing proves the timer resets per event.
		process.env.SANDBOX_AGENT_IDLE_TIMEOUT_MS = "2000";

		const events: AgentEvent[] = [];
		const result = await spawnAgent(makeInput((e) => events.push(e)));

		expect(result.exitCode).toBe(0);
		expect(events.find((e) => e.type === "failed")).toBeUndefined();
		const deltas = events.filter((e) => e.type === "text_delta");
		expect(deltas.length).toBe(6);
	}, 15_000);

	it("kills a lingering child after completed without a spurious failed", async () => {
		process.env.SANDBOX_AGENT_PATH = fixtures.agentLinger;
		// Same 2s window as above to absorb bun's cold start before `completed`.
		process.env.SANDBOX_AGENT_IDLE_TIMEOUT_MS = "2000";

		const events: AgentEvent[] = [];
		const start = Date.now();
		const result = await spawnAgent(makeInput((e) => events.push(e)));
		const elapsed = Date.now() - start;

		// The watchdog must bound the wait on the never-exiting child...
		expect(elapsed).toBeLessThan(10_000);
		expect(result.exitCode).not.toBe(0);
		// ...without reporting a failure for an answer that fully streamed.
		expect(events.find((e) => e.type === "completed")).toBeDefined();
		expect(events.find((e) => e.type === "failed")).toBeUndefined();
	}, 15_000);
});
