/**
 * Probe: end-to-end reproducer for issue #78. Drives the Claude Agent SDK
 * directly with the production system prompt against the NEW filesystem layout
 * (canonical/ with frontmatter-embedded metadata, no symlinks) and verifies
 * the agent can find files via the Grep tool.
 *
 * Flow:
 *   1. Bundle sandbox-daemon/probe-inner.ts via Bun.build (same pattern the
 *      daemon uses), producing a single JS file with the SDK inlined.
 *   2. Create an E2B sandbox from the dev template.
 *   3. Wrap both ripgrep binaries (/usr/bin/rg and the vendored one) so we can
 *      observe the exact argv Claude Code passes — belt-and-suspenders.
 *   4. Populate /workspace/data/probe-user/canonical/{type}/{doc}.md with real
 *      files carrying the new frontmatter shape (summaryId, type, checksum,
 *      collections). No symlinks anywhere.
 *   5. Upload the bundled inner script + a JSON config, run it, capture the
 *      full message stream.
 *
 * Expected result: the agent should answer "Paris" (before the fix: "I cannot
 * find this information").
 *
 * Usage:
 *   bun run scripts/probe-agent-tools.ts [userPrompt]
 *
 * Requires: E2B_API_KEY, E2B_TEMPLATE, ANTHROPIC_API_KEY
 */

import { resolve } from "node:path";
import { Sandbox } from "e2b";
import "@/config/env";
import { buildSandboxAgentPrompt } from "@/features/sandbox-agent";

const TEMPLATE = Bun.env.E2B_TEMPLATE ?? "sandbox-template-dev";
const ROOT = "/workspace/data/probe-user";

const userPrompt = process.argv[2] ?? "What is the capital of France?";

async function buildInnerBundle(): Promise<string> {
	const entrypoint = resolve(
		import.meta.dirname,
		"../../sandbox-daemon/probe-inner.ts",
	);
	const result = await Bun.build({
		entrypoints: [entrypoint],
		target: "bun",
		minify: false,
	});
	if (!result.success) {
		throw new Error(
			`probe bundle failed:\n${result.logs.map((l) => l.message).join("\n")}`,
		);
	}
	const out = result.outputs[0];
	if (!out) throw new Error("probe bundle produced no output");
	return out.text();
}

async function main() {
	const bundleCode = await buildInnerBundle();
	console.log(
		`Inner bundle built: ${(bundleCode.length / 1024).toFixed(1)} KB`,
	);
	console.log(`User prompt: ${JSON.stringify(userPrompt)}`);

	const systemPrompt = buildSandboxAgentPrompt({
		scope: "general",
		summaryId: null,
		collectionId: null,
		docsRoot: ROOT,
		conversationContext: null,
	});

	const config = {
		userPrompt,
		systemPrompt,
		// New layout: scope=global cwd is canonical/ directly (no scopes/ layer).
		cwd: `${ROOT}/canonical`,
	};

	console.log(`Creating sandbox from template=${TEMPLATE}...`);
	const sandbox = await Sandbox.create(TEMPLATE);
	console.log(`Sandbox: ${sandbox.sandboxId}\n`);

	try {
		// Wrap every rg ELF binary we can find. Claude Code vendors its own
		// ripgrep under node_modules/@anthropic-ai/claude-code/vendor/ripgrep.
		const rgPaths = [
			"/usr/bin/rg",
			"/usr/local/lib/node_modules/@anthropic-ai/claude-code/vendor/ripgrep/x64-linux/rg",
		];

		for (const orig of rgPaths) {
			const real = `${orig}.real`;
			const wrapperScript = [
				"#!/bin/sh",
				"{",
				`  printf '[%s] bin=%s cwd=%s argv:' "$(date +%s.%N)" "${orig}" "$PWD"`,
				'  for a in "$@"; do printf \' [%s]\' "$a"; done',
				"  printf '\\n'",
				"} >> /tmp/rg-trace.log 2>/dev/null",
				`exec ${real} "$@"`,
			].join("\n");
			const wrapperTmp = `/tmp/rg-wrapper-${Buffer.from(orig).toString("base64url")}.sh`;
			await sandbox.files.write(wrapperTmp, wrapperScript);
			const installRes = await sandbox.commands
				.run(
					`set -e; if [ ! -f '${real}' ]; then sudo mv '${orig}' '${real}'; fi; sudo cp '${wrapperTmp}' '${orig}'; sudo chmod +x '${orig}'; echo wrapped ${orig}`,
					{ timeoutMs: 5_000 },
				)
				.catch((err: unknown) => {
					const e = err as { result?: { stdout?: string; stderr?: string } };
					return e.result ?? { stdout: "", stderr: String(err) };
				});
			console.log(installRes.stdout?.trim() || installRes.stderr?.trim());
		}
		await sandbox.commands.run(": > /tmp/rg-trace.log", { timeoutMs: 5_000 });

		// New flat layout: real files only, new frontmatter shape with checksum
		// and collections.
		await sandbox.commands.run(
			`mkdir -p ${ROOT}/canonical/0 ${ROOT}/canonical/3`,
		);
		await sandbox.files.write(
			`${ROOT}/canonical/0/doc-1.md`,
			'---\nsummaryId: doc-1\ntype: 0\nchecksum: sum-1\ncollections: ["col-test"]\n---\n\nThe capital of France is Paris. It is known for the Eiffel Tower.\n',
		);
		await sandbox.files.write(
			`${ROOT}/canonical/3/doc-2.md`,
			"---\nsummaryId: doc-2\ntype: 3\nchecksum: sum-2\n---\n\nBuy milk, eggs, and bread.\n",
		);

		const lsRes = await sandbox.commands.run(`find ${ROOT}/canonical -type f`, {
			timeoutMs: 5_000,
		});
		console.log("Filesystem layout:\n" + lsRes.stdout);

		await sandbox.files.write("/tmp/probe-inner.js", bundleCode);
		await sandbox.files.write("/tmp/probe-config.json", JSON.stringify(config));

		console.log("Running agent probe via SDK...\n--- SDK messages ---");

		const anthropicKey = Bun.env.ANTHROPIC_API_KEY ?? "";
		if (!anthropicKey) {
			throw new Error("ANTHROPIC_API_KEY not set in environment");
		}

		const res = await sandbox.commands
			.run("bun run /tmp/probe-inner.js", {
				timeoutMs: 180_000,
				envs: { ANTHROPIC_API_KEY: anthropicKey },
			})
			.catch((err: unknown) => {
				const e = err as {
					result?: { stdout?: string; stderr?: string; exitCode?: number };
				};
				if (e.result) return e.result;
				throw err;
			});

		const stdout = "stdout" in res ? res.stdout : "";
		const stderr = "stderr" in res ? res.stderr : "";
		const exitCode = "exitCode" in res ? res.exitCode : -1;

		for (const line of stdout.split("\n")) {
			const t = line.trim();
			if (!t) continue;
			try {
				console.log(JSON.stringify(JSON.parse(t), null, 2));
				console.log("---");
			} catch {
				console.log(t);
			}
		}

		if (stderr.trim()) {
			console.log("\n--- STDERR ---\n" + stderr);
		}
		console.log(`\n(exit=${exitCode})`);

		const trace = await sandbox.commands.run("cat /tmp/rg-trace.log", {
			timeoutMs: 5_000,
		});
		console.log("\n--- rg-trace.log ---");
		console.log(
			trace.stdout || "(empty — rg was never invoked as a subprocess)",
		);
	} finally {
		console.log("\nKilling sandbox...");
		await sandbox.kill().catch(() => {});
	}
}

main().then(
	() => process.exit(0),
	(err) => {
		console.error("probe failed:", err);
		process.exit(1);
	},
);
