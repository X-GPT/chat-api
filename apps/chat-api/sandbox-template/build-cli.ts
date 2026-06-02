import { join } from "node:path";

// The mymemo-docs CLI is its own app (apps/mymemo-docs). Build it and stage its
// bundled artifact here so template.ts's `.copy("mymemo-docs", ...)` can bake it
// onto the sandbox PATH. The staged file is generated (gitignored).
const CLI_APP = join(import.meta.dir, "../../mymemo-docs");
const STAGED = join(import.meta.dir, "mymemo-docs");

/** Build the standalone mymemo-docs CLI and stage its artifact for `.copy()`. */
export async function bundleCli(): Promise<string> {
	const proc = Bun.spawn(["bun", "run", "build"], {
		cwd: CLI_APP,
		stdout: "pipe",
		stderr: "pipe",
	});
	if ((await proc.exited) !== 0) {
		throw new Error(
			`failed to build mymemo-docs: ${await new Response(proc.stderr).text()}`,
		);
	}
	await Bun.write(STAGED, Bun.file(join(CLI_APP, "dist/mymemo-docs")));
	return STAGED;
}
