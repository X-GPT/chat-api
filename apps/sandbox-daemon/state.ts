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
const VERSION_FILENAME = ".synced-version";

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

export function readSyncedVersion(dataRoot: string): number {
	const versionPath = `${dataRoot}/${VERSION_FILENAME}`;
	try {
		const raw = readFileSync(versionPath, "utf-8").trim();
		const parsed = Number.parseInt(raw, 10);
		return Number.isNaN(parsed) ? 0 : parsed;
	} catch {
		return 0;
	}
}

export function writeSyncedVersion(dataRoot: string, version: number): void {
	const versionPath = `${dataRoot}/${VERSION_FILENAME}`;
	ensureParentDir(versionPath);
	writeFileSync(versionPath, String(version), "utf-8");
}
