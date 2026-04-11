/**
 * Local manifest I/O for tracking synced state on the sandbox filesystem.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { ensureParentDir } from "./fs-utils";

export interface LocalManifestEntry {
	document_id: string;
	type: number;
	slug: string;
	path_key: string;
	checksum: string;
}

const MANIFEST_FILENAME = ".sync-manifest.json";

export function readLocalManifest(dataRoot: string): LocalManifestEntry[] {
	const manifestPath = `${dataRoot}/${MANIFEST_FILENAME}`;
	try {
		const raw = readFileSync(manifestPath, "utf-8");
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function writeLocalManifest(
	dataRoot: string,
	entries: LocalManifestEntry[],
): void {
	const manifestPath = `${dataRoot}/${MANIFEST_FILENAME}`;
	ensureParentDir(manifestPath);
	writeFileSync(manifestPath, JSON.stringify(entries), "utf-8");
}
