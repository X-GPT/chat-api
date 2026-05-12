import { describe, expect, it } from "bun:test";
import { buildAgentSpawnArgv } from "./child-spawn";

describe("buildAgentSpawnArgv", () => {
	it("wraps bun /workspace/agent.js with bwrap and the agreed flags", () => {
		const argv = buildAgentSpawnArgv("/workspace/data/u1/canonical");

		expect(argv[0]).toBe("bwrap");

		const dashDash = argv.indexOf("--");
		expect(dashDash).toBeGreaterThan(0);
		expect(argv.slice(dashDash)).toEqual([
			"--",
			"bun",
			"/workspace/agent.js",
		]);

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
		// agent can reach api.anthropic.com.
		expect(flags).toContain("--unshare-user");
		expect(flags).toContain("--unshare-pid");
		expect(flags).toContain("--unshare-uts");
		expect(flags).toContain("--unshare-ipc");
		expect(flags).not.toContain("--unshare-net");
		expect(flags).not.toContain("--unshare-all");
		// Lifetime: bwrap + agent should die if the daemon goes away.
		expect(flags).toContain("--die-with-parent");
	});

	it("masks /workspace/data, then re-binds only the selected scope rw", () => {
		const cwd = "/workspace/data/u2/scopes/request-doc-42";
		const argv = buildAgentSpawnArgv(cwd);

		const roRootIdx = argv.findIndex(
			(a, i) => a === "--ro-bind" && argv[i + 1] === "/" && argv[i + 2] === "/",
		);
		const tmpfsDataIdx = argv.findIndex(
			(a, i) => a === "--tmpfs" && argv[i + 1] === "/workspace/data",
		);
		const bindCwdIdx = argv.findIndex(
			(a, i) => a === "--bind" && argv[i + 1] === cwd && argv[i + 2] === cwd,
		);

		expect(roRootIdx).toBeGreaterThan(-1);
		expect(tmpfsDataIdx).toBeGreaterThan(-1);
		expect(bindCwdIdx).toBeGreaterThan(-1);

		// Ordering matters: later mounts shadow earlier ones for the same
		// subtree. Required order: ro-bind / first, tmpfs over /workspace/data
		// second (masks every user's data tree), bind cwd third (re-exposes
		// only the selected scope). Cross-scope reads via absolute paths
		// outside cwd are blocked by the tmpfs.
		expect(roRootIdx).toBeLessThan(tmpfsDataIdx);
		expect(tmpfsDataIdx).toBeLessThan(bindCwdIdx);
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
