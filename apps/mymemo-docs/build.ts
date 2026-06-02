import { join } from "node:path";

const SRC = join(import.meta.dir, "src/index.ts");
const DEFAULT_OUT = join(import.meta.dir, "dist/mymemo-docs");

/**
 * Bundle the citty-based CLI into a single self-contained file (citty inlined),
 * runnable via its `#!/usr/bin/env bun` shebang. The sandbox has `bun` but no
 * node_modules, so the shipped CLI must be bundled. Builds in-process via the
 * Bun.build API (no subprocess); `outfile` lets a caller bundle straight to its
 * own target. Returns the output path.
 */
export async function build(outfile: string = DEFAULT_OUT): Promise<string> {
	const result = await Bun.build({ entrypoints: [SRC], target: "bun" });
	if (!result.success) {
		throw new AggregateError(result.logs, "failed to bundle mymemo-docs");
	}
	const [artifact] = result.outputs;
	if (!artifact) throw new Error("mymemo-docs bundle produced no output");
	await Bun.write(outfile, artifact);
	return outfile;
}

if (import.meta.main) await build();
