import type { Sandbox } from "e2b";
import { computeChecksum } from "./materialization";
import type { ManifestDiff, SyncStateRecord } from "./sync-state.types";

/**
 * List all .txt files under the docs root in the sandbox.
 * Returns paths relative to the sandbox filesystem root.
 */
export async function listSandboxFiles(
	sandbox: Sandbox,
	docsRoot: string,
): Promise<string[]> {
	const result = await sandbox.commands.run(
		`find ${docsRoot} -type f -name '*.txt' 2>/dev/null`,
		{ timeoutMs: 10_000 },
	);

	if (result.exitCode !== 0 || !result.stdout.trim()) {
		return [];
	}

	return result.stdout
		.trim()
		.split("\n")
		.filter((line) => line.length > 0);
}

/**
 * Read a file from the sandbox and compute its SHA-256 checksum.
 * Returns null if the file does not exist or cannot be read.
 */
export async function readSandboxFileChecksum(
	sandbox: Sandbox,
	path: string,
): Promise<string | null> {
	try {
		const content = await sandbox.files.read(path);
		return computeChecksum(content);
	} catch {
		return null;
	}
}

/**
 * Compare expected state (from sync-state records) against actual sandbox filesystem.
 * Returns a diff describing missing files, orphaned files, and checksum mismatches.
 */
export async function diffManifest(
	expectedRecords: SyncStateRecord[],
	sandbox: Sandbox,
	docsRoot: string,
): Promise<ManifestDiff> {
	const actualFiles = await listSandboxFiles(sandbox, docsRoot);
	const actualSet = new Set(actualFiles);

	const missingInSandbox: SyncStateRecord[] = [];
	const checksumMismatches: SyncStateRecord[] = [];
	const expectedPaths = new Set<string>();

	for (const record of expectedRecords) {
		expectedPaths.add(record.expectedPath);

		if (!actualSet.has(record.expectedPath)) {
			missingInSandbox.push(record);
			continue;
		}

		const actualChecksum = await readSandboxFileChecksum(
			sandbox,
			record.expectedPath,
		);
		if (actualChecksum !== null && actualChecksum !== record.contentChecksum) {
			checksumMismatches.push(record);
		}
	}

	const orphanedInSandbox = actualFiles.filter(
		(path) => !expectedPaths.has(path),
	);

	return { missingInSandbox, orphanedInSandbox, checksumMismatches };
}
