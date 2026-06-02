import { join } from "node:path";
import { build } from "../../mymemo-docs/build";

// The mymemo-docs CLI is its own app (apps/mymemo-docs). Bundle it straight into
// this directory so template.ts's `.copy("mymemo-docs", ...)` can bake it onto
// the sandbox PATH. The staged artifact is generated (gitignored).
const STAGED = join(import.meta.dir, "mymemo-docs");

/** Bundle the standalone mymemo-docs CLI to the staged artifact for `.copy()`. */
export function bundleCli(): Promise<string> {
	return build(STAGED);
}
