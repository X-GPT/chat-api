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

	it("binds the cwd path as read-write, not just read-only", () => {
		const cwd = "/workspace/data/u2/scopes/request-doc-42";
		const argv = buildAgentSpawnArgv(cwd);

		// --bind <cwd> <cwd> must appear (rw binding for the agent's scope).
		const bindIdx = argv.findIndex(
			(a, i) => a === "--bind" && argv[i + 1] === cwd && argv[i + 2] === cwd,
		);
		expect(bindIdx).toBeGreaterThan(-1);

		// And the read-only root mount must appear before it (later mounts
		// shadow earlier ones; cwd's rw bind must come after `/` ro-bind).
		const roRootIdx = argv.findIndex(
			(a, i) => a === "--ro-bind" && argv[i + 1] === "/" && argv[i + 2] === "/",
		);
		expect(roRootIdx).toBeGreaterThan(-1);
		expect(roRootIdx).toBeLessThan(bindIdx);
	});

	it("respects SANDBOX_BWRAP_PATH and SANDBOX_BUN_PATH env overrides", async () => {
		const original = {
			bwrap: process.env.SANDBOX_BWRAP_PATH,
			bun: process.env.SANDBOX_BUN_PATH,
			agent: process.env.SANDBOX_AGENT_PATH,
		};
		process.env.SANDBOX_BWRAP_PATH = "/custom/bwrap";
		process.env.SANDBOX_BUN_PATH = "/custom/bun";
		process.env.SANDBOX_AGENT_PATH = "/custom/agent.js";

		// Reimport with overrides applied at module init time.
		const fresh = await import(`./child-spawn?t=${Date.now()}`);
		const argv = fresh.buildAgentSpawnArgv("/tmp/cwd");
		expect(argv[0]).toBe("/custom/bwrap");
		expect(argv.slice(-2)).toEqual(["/custom/bun", "/custom/agent.js"]);

		process.env.SANDBOX_BWRAP_PATH = original.bwrap;
		process.env.SANDBOX_BUN_PATH = original.bun;
		process.env.SANDBOX_AGENT_PATH = original.agent;
	});
});
