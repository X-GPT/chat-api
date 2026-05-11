/**
 * Probe: verify whether `bwrap` (bubblewrap) works inside an E2B sandbox.
 *
 * Bubblewrap relies on unprivileged user namespaces. Inside a container the
 * answer depends on the host kernel and the container's capability set, so
 * the only reliable way to know is to try it.
 *
 * Last verified: 2026-05-11 — bubblewrap 0.8.0 from Debian bookworm works
 * fully inside the dev template. `--unshare-all` (user/pid/net) and tmpfs
 * mounts all succeed. `kernel.unprivileged_userns_clone` reads "unsupported"
 * (the sysctl is absent on modern kernels), but user namespaces work
 * regardless. Adding `bubblewrap` to the template's aptInstall list so it
 * ships pre-installed.
 *
 * Re-run this probe after any template change that touches the base image
 * or capabilities.
 *
 * Usage:
 *   bun run scripts/probe-bwrap.ts
 *
 * Requires: E2B_API_KEY, E2B_TEMPLATE
 */

import { Sandbox } from "e2b";

if (!Bun.env.E2B_API_KEY) {
	console.error("E2B_API_KEY is required");
	process.exit(1);
}
const TEMPLATE = Bun.env.E2B_TEMPLATE ?? "sandbox-template-dev";

interface CmdResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

async function run(sandbox: Sandbox, cmd: string): Promise<CmdResult> {
	try {
		const res = await sandbox.commands.run(cmd, { timeoutMs: 120_000 });
		return {
			exitCode: res.exitCode,
			stdout: res.stdout?.trim() ?? "",
			stderr: res.stderr?.trim() ?? "",
		};
	} catch (err) {
		const e = err as {
			result?: { exitCode?: number; stdout?: string; stderr?: string };
		};
		return {
			exitCode: e.result?.exitCode ?? -1,
			stdout: e.result?.stdout?.trim() ?? "",
			stderr: e.result?.stderr?.trim() ?? String(err),
		};
	}
}

function summarize(label: string, res: CmdResult): void {
	console.log(`\n--- ${label} (exit=${res.exitCode}) ---`);
	if (res.stdout) console.log(`stdout: ${res.stdout}`);
	if (res.stderr) console.log(`stderr: ${res.stderr}`);
}

async function main() {
	console.log(`Creating sandbox from template: ${TEMPLATE}`);
	const sandbox = await Sandbox.create(TEMPLATE, {
		metadata: { purpose: "probe-bwrap" },
	});
	console.log(`Sandbox: ${sandbox.sandboxId}`);

	try {
		const whichBefore = await run(sandbox, "which bwrap || true");
		summarize("which bwrap (pre-install)", whichBefore);

		if (whichBefore.exitCode !== 0 || !whichBefore.stdout) {
			console.log("\nbwrap not in image — attempting apt install...");
			const aptUpdate = await run(sandbox, "sudo apt-get update");
			summarize("sudo apt-get update", aptUpdate);
			const aptInstall = await run(
				sandbox,
				"sudo DEBIAN_FRONTEND=noninteractive apt-get install -y bubblewrap",
			);
			summarize("sudo apt-get install bubblewrap", aptInstall);
		}

		const whichAfter = await run(sandbox, "which bwrap");
		summarize("which bwrap (post-install)", whichAfter);

		const version = await run(sandbox, "bwrap --version");
		summarize("bwrap --version", version);

		const userNs = await run(
			sandbox,
			"cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo unsupported",
		);
		summarize("kernel.unprivileged_userns_clone", userNs);

		const ranNoNet = await run(
			sandbox,
			"bwrap --ro-bind / / --proc /proc --dev /dev --unshare-user --unshare-pid --unshare-net id",
		);
		summarize("bwrap --unshare-user --unshare-pid --unshare-net id", ranNoNet);

		const ranAllUnshared = await run(
			sandbox,
			"bwrap --ro-bind / / --proc /proc --dev /dev --unshare-all id",
		);
		summarize("bwrap --unshare-all id", ranAllUnshared);

		const ranInTmp = await run(
			sandbox,
			"bwrap --ro-bind / / --proc /proc --dev /dev --tmpfs /tmp --unshare-all sh -c 'echo hello > /tmp/x && cat /tmp/x'",
		);
		summarize(
			"bwrap --tmpfs /tmp --unshare-all 'write+read /tmp/x'",
			ranInTmp,
		);

		const works =
			version.exitCode === 0 &&
			ranNoNet.exitCode === 0 &&
			ranAllUnshared.exitCode === 0 &&
			ranInTmp.exitCode === 0;
		console.log(
			`\n=== Result: bwrap ${works ? "WORKS" : "DOES NOT FULLY WORK"} in this template ===`,
		);
		if (!works) process.exitCode = 1;
	} finally {
		await sandbox.kill().catch(() => {});
	}
}

main().catch((err) => {
	console.error("Probe failed:", err);
	process.exit(1);
});
