import {
	buildCollectionIndex,
	buildCollectionSymlink,
	buildScopeRoots,
	type DocFile,
	getDataRoot,
	removeCanonicalFile,
	removeCollectionEntries,
	removeCollectionIndex,
	writeCanonicalFile,
} from "./materialization";
import { getFileContents, getManifest } from "./queries";
import {
	type LocalManifestEntry,
	readLocalManifest,
	writeLocalManifest,
} from "./state";

interface ReconcileInput {
	userId: string;
}

function parseCollectionIds(pathKey: string): string[] {
	if (!pathKey) return [];
	return pathKey
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean);
}

function hasEntryChanged(
	local: LocalManifestEntry,
	remote: LocalManifestEntry,
): boolean {
	return (
		local.checksum !== remote.checksum ||
		local.type !== remote.type ||
		local.path_key !== remote.path_key
	);
}

// Assumes both sides are ordered by document_id. Enforced by
// getManifest()'s ORDER BY and by writeLocalManifest at the tail of reconcile().
function manifestsEqual(
	local: LocalManifestEntry[],
	remote: LocalManifestEntry[],
): boolean {
	if (local.length !== remote.length) return false;
	for (let i = 0; i < local.length; i++) {
		const l = local[i]!;
		const r = remote[i]!;
		if (l.document_id !== r.document_id || hasEntryChanged(l, r)) {
			return false;
		}
	}
	return true;
}

/**
 * Reconcile the local filesystem state with the database.
 * Returns true if sync was performed, false if skipped.
 */
export async function reconcile(input: ReconcileInput): Promise<boolean> {
	const { userId } = input;
	const dataRoot = getDataRoot(userId);

	const remoteManifest = await getManifest(userId);
	const localManifest = readLocalManifest(dataRoot);

	if (manifestsEqual(localManifest, remoteManifest)) {
		return false;
	}

	const localMap = new Map(
		localManifest.map((entry) => [entry.document_id, entry]),
	);
	const remoteMap = new Map(
		remoteManifest.map((entry) => [entry.document_id, entry]),
	);

	// Parse collection IDs once and build a collection → docs index
	const allCollectionIds = new Set<string>();
	const collectionDocsIndex = new Map<
		string,
		Array<{ document_id: string; type: number }>
	>();
	const remoteCollectionIds = new Map<string, string[]>();

	for (const entry of remoteManifest) {
		const colIds = parseCollectionIds(entry.path_key);
		remoteCollectionIds.set(entry.document_id, colIds);
		for (const colId of colIds) {
			allCollectionIds.add(colId);
			if (!collectionDocsIndex.has(colId)) {
				collectionDocsIndex.set(colId, []);
			}
			collectionDocsIndex.get(colId)?.push({
				document_id: entry.document_id,
				type: entry.type,
			});
		}
	}

	const creates: string[] = [];
	const updates: string[] = [];
	const deletes: LocalManifestEntry[] = [];

	for (const entry of remoteManifest) {
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

	const changedFiles = await getFileContents(userId, changedIds);

	const collectionsToRebuild = new Set<string>();

	// Handle deletes
	for (const entry of deletes) {
		const colIds = parseCollectionIds(entry.path_key);
		if (colIds.length > 0) {
			removeCollectionEntries(dataRoot, entry, colIds);
			for (const colId of colIds) {
				collectionsToRebuild.add(colId);
			}
		}
		removeCanonicalFile(dataRoot, entry);
	}

	// Handle creates/updates
	for (const file of changedFiles) {
		const local = localMap.get(file.document_id);
		if (local) {
			// If type changed, canonical path changed — remove old file
			if (local.type !== file.type) {
				removeCanonicalFile(dataRoot, local);
			}
			// Clean up old collection symlinks
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
			path_key: file.path_key,
			content: file.content,
			checksum: file.checksum,
		};
		writeCanonicalFile(dataRoot, doc);

		const newColIds = remoteCollectionIds.get(file.document_id) ?? [];
		for (const colId of newColIds) {
			buildCollectionSymlink(dataRoot, doc, colId);
			collectionsToRebuild.add(colId);
		}
	}

	// Rebuild indexes for touched collections using pre-built index (O(1) lookup)
	for (const colId of collectionsToRebuild) {
		const docs = collectionDocsIndex.get(colId) ?? [];
		if (docs.length > 0) {
			buildCollectionIndex(dataRoot, colId, docs);
		} else {
			removeCollectionIndex(dataRoot, colId);
		}
	}

	buildScopeRoots(dataRoot, [...allCollectionIds]);

	const newManifest: LocalManifestEntry[] = remoteManifest.map((entry) => ({
		document_id: entry.document_id,
		type: entry.type,
		path_key: entry.path_key,
		checksum: entry.checksum,
	}));

	writeLocalManifest(dataRoot, newManifest);

	return true;
}
