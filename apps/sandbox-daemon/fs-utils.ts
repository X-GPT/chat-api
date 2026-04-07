import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Ensure the parent directory of a file path exists.
 * Uses recursive mkdir which is a no-op if the directory already exists.
 */
export function ensureParentDir(filePath: string): void {
	mkdirSync(dirname(filePath), { recursive: true });
}
