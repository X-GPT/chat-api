import { getPool } from "./db";
import {
	buildCollectionIndex,
	buildCollectionSymlink,
	buildScopeRoots,
	type DocFile,
	getDataRoot,
	removeCanonicalFile,
	removeCollectionEntries,
	writeCanonicalFile,
} from "./materialization";
import {
	type LocalManifestEntry,
	readLocalManifest,
	readSyncedVersion,
	writeLocalManifest,
	writeSyncedVersion,
} from "./state";

interface ReconcileInput {
	userId: string;
	requiredVersion: number;
}

interface ManifestRow {
	document_id: string;
	type: number;
	slug: string;
	path_key: string;
	checksum: string;
}

interface FileContentRow extends ManifestRow {
	content: string;
}

function parseCollectionIds(pathKey: string): string[] {
	if (!pathKey) return [];
	return pathKey
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean);
}

/** Check if any tracked field changed (not just checksum). */
function hasEntryChanged(
	local: LocalManifestEntry,
	remote: ManifestRow,
): boolean {
	return (
		local.checksum !== remote.checksum ||
		local.type !== remote.type ||
		local.slug !== remote.slug ||
		local.path_key !== remote.path_key
	);
}

/**
 * Reconcile the local filesystem state with the database.
 * Returns true if sync was performed, false if skipped.
 */
export async function reconcile(input: ReconcileInput): Promise<boolean> {
	const { userId, requiredVersion } = input;
	const dataRoot = getDataRoot(userId);
	const localVersion = readSyncedVersion(dataRoot);

	if (localVersion >= requiredVersion) {
		return false;
	}

	const pool = getPool();

	const manifestResult = await pool.query<ManifestRow>(
		`SELECT document_id, type, slug, path_key, checksum
		 FROM user_files
		 WHERE user_id = $1
		 ORDER BY document_id`,
		[userId],
	);
	const remoteManifest = manifestResult.rows;

	const localManifest = readLocalManifest(dataRoot);
	const localMap = new Map(
		localManifest.map((entry) => [entry.document_id, entry]),
	);
	const remoteMap = new Map(
		remoteManifest.map((entry) => [entry.document_id, entry]),
	);

	const allCollectionIds = new Set<string>();
	const creates: string[] = [];
	const updates: string[] = [];
	const deletes: LocalManifestEntry[] = [];

	for (const entry of remoteManifest) {
		for (const colId of parseCollectionIds(entry.path_key)) {
			allCollectionIds.add(colId);
		}
		const local = localMap.get(entry.document_id);
		if (!local) {
			creates.push(entry.document_id);
		} else if (hasEntryChanged(local, entry)) {
			updates.push(entry.document_id);
		}
	}

	for (const entry of localManifest) {
		if (!remoteMap.has(entry.document_id)) {
			deletes.push(entry);
		}
	}

	const changedIds = [...creates, ...updates];

	let changedFiles: FileContentRow[] = [];
	if (changedIds.length > 0) {
		const contentResult = await pool.query<FileContentRow>(
			`SELECT document_id, type, slug, path_key, content, checksum
			 FROM user_files
			 WHERE user_id = $1 AND document_id = ANY($2)`,
			[userId, changedIds],
		);
		changedFiles = contentResult.rows;
	}

	// Handle deletes — remove canonical files and collection symlinks
	const collectionsToRebuild = new Set<string>();
	for (const entry of deletes) {
		const collectionIds = parseCollectionIds(entry.path_key);
		if (collectionIds.length > 0) {
			removeCollectionEntries(dataRoot, entry, collectionIds);
			for (const colId of collectionIds) {
				collectionsToRebuild.add(colId);
			}
		}
		removeCanonicalFile(dataRoot, entry);
	}

	// Handle creates/updates — clean up stale paths on rename, then write
	for (const file of changedFiles) {
		const local = localMap.get(file.document_id);
		if (local) {
			// If document_id or type changed, remove old canonical file
			if (local.document_id !== file.document_id || local.type !== file.type) {
				removeCanonicalFile(dataRoot, local);
			}
			// Clean up old collection symlinks if path_key changed
			const oldColIds = parseCollectionIds(local.path_key);
			if (oldColIds.length > 0) {
				removeCollectionEntries(dataRoot, local, oldColIds);
				for (const colId of oldColIds) {
					collectionsToRebuild.add(colId);
				}
			}
		}

		const doc: DocFile = {
			document_id: file.document_id,
			type: file.type,
			slug: file.slug,
			path_key: file.path_key,
			content: file.content,
			checksum: file.checksum,
		};
		writeCanonicalFile(dataRoot, doc);

		for (const colId of parseCollectionIds(file.path_key)) {
			buildCollectionSymlink(dataRoot, doc, colId);
			collectionsToRebuild.add(colId);
		}
	}

	// Rebuild indexes for all touched collections using the full remote manifest
	for (const colId of collectionsToRebuild) {
		const allDocsInCollection = remoteManifest
			.filter((e) => parseCollectionIds(e.path_key).includes(colId))
			.map((e) => ({
				document_id: e.document_id,
				type: e.type,
				slug: e.slug,
			}));
		buildCollectionIndex(dataRoot, colId, allDocsInCollection);
	}

	buildScopeRoots(dataRoot, [...allCollectionIds]);

	const newManifest: LocalManifestEntry[] = remoteManifest.map((entry) => ({
		document_id: entry.document_id,
		type: entry.type,
		slug: entry.slug,
		path_key: entry.path_key,
		checksum: entry.checksum,
	}));

	writeLocalManifest(dataRoot, newManifest);
	writeSyncedVersion(dataRoot, requiredVersion);

	return true;
}
