/**
 * Probe: verify the bundled `mymemo-docs` CLI is present, on PATH, and runnable
 * inside a real E2B sandbox built from the dev template.
 *
 * Requires: E2B_API_KEY (E2B_TEMPLATE optional, defaults to sandbox-template-dev)
 *   bun run scripts/probe-docs-cli.ts
 */
import { Sandbox } from "e2b";

const TEMPLATE = Bun.env.E2B_TEMPLATE ?? "sandbox-template-dev";

async function run(sandbox: Sandbox, cmd: string) {
	const res = await sandbox.commands
		.run(cmd, { timeoutMs: 60_000, envs: { NO_COLOR: "1" } })
		.catch((e) => ({
			exitCode: (e as { exitCode?: number }).exitCode ?? -1,
			stdout: "",
			stderr: (e as Error).message,
		}));
	console.log(`\n$ ${cmd}`);
	console.log(`  exit=${res.exitCode}`);
	if (res.stdout.trim()) console.log(res.stdout.trim().replace(/^/gm, "  | "));
	if (res.stderr.trim())
		console.log(res.stderr.trim().replace(/^/gm, "  err| "));
}

async function main() {
	console.log(`Creating sandbox from template: ${TEMPLATE}`);
	const sandbox = await Sandbox.create(TEMPLATE, { timeoutMs: 60_000 });
	console.log(`Sandbox: ${sandbox.sandboxId}`);
	try {
		await run(sandbox, "which mymemo-docs");
		await run(sandbox, "ls -l /usr/local/bin/mymemo-docs");
		await run(sandbox, "mymemo-docs --help");
		await run(sandbox, "mymemo-docs search --help");
		await run(sandbox, "mymemo-docs"); // no command -> exit 1
		await run(sandbox, 'mymemo-docs search "machine learning"'); // no token env -> our error
	} finally {
		await sandbox.kill();
		console.log("\nSandbox killed.");
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
