import { join } from "node:path";

const SRC = join(import.meta.dir, "src/index.ts");
const OUT = join(import.meta.dir, "dist/mymemo-docs");

/**
 * Bundle the citty-based CLI into a single self-contained file (citty inlined),
 * runnable via its `#!/usr/bin/env bun` shebang. The sandbox has `bun` but no
 * node_modules, so the shipped CLI must be bundled. The artifact is generated
 * (dist/ is gitignored); `src/index.ts` is the source.
 */
export async function build(): Promise<string> {
	const proc = Bun.spawn(
		["bun", "build", SRC, "--outfile", OUT, "--target", "bun"],
		{ stdout: "pipe", stderr: "pipe" },
	);
	if ((await proc.exited) !== 0) {
		throw new Error(
			`failed to bundle mymemo-docs: ${await new Response(proc.stderr).text()}`,
		);
	}
	return OUT;
}

if (import.meta.main) await build();
