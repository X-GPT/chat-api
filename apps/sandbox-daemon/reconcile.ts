import {
	buildCollectionHardlink,
	clearDataRoot,
	type DocFile,
	ensureDataRoot,
	getDataRoot,
	type LocalManifestEntry,
	manifestExists,
	readManifest,
	removeCanonicalFile,
	removeCollectionEntries,
	writeCanonicalFile,
	writeIndexFile,
	writeManifest,
} from "./materialization";
import { getCollectionNames, getFileContents, getManifest } from "./queries";

interface ReconcileInput {
	userId: string;
}

function collectionsEqual(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function hasEntryChanged(
	local: LocalManifestEntry,
	remote: LocalManifestEntry,
): boolean {
	return (
		local.checksum !== remote.checksum ||
		local.type !== remote.type ||
		local.title !== remote.title ||
		!collectionsEqual(local.collections, remote.collections)
	);
}

// Assumes both sides are ordered by document_id. Enforced by
// getManifest()'s ORDER BY and readManifest's stored order.
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
 * Compare stored collection names against current names.
 * Returns the set of collection IDs whose names differ (empty if none changed).
 */
function findRenamedCollections(
	stored: Record<string, string>,
	current: Map<string, string>,
): Set<string> {
	const renamed = new Set<string>();
	for (const [id, name] of current) {
		if (stored[id] !== name) renamed.add(id);
	}
	for (const id of Object.keys(stored)) {
		if (!current.has(id)) renamed.add(id);
	}
	return renamed;
}

/**
 * Reconcile the local filesystem state with the database.
 * Returns true if sync was performed, false if skipped.
 */
export async function reconcile(input: ReconcileInput): Promise<boolean> {
	const { userId } = input;
	const dataRoot = getDataRoot(userId);
	ensureDataRoot(dataRoot);

	// Check before async reads — if no manifest file exists, we'll need a full wipe.
	const hasManifest = manifestExists(dataRoot);

	const [remoteManifest, manifestData, collectionRows] = await Promise.all([
		getManifest(userId),
		readManifest(dataRoot),
		getCollectionNames(userId),
	]);

	// Missing/corrupt manifest file — wipe and full resync to prevent orphaned files.
	// Distinguished from a genuinely empty workspace (new user) where the manifest
	// file exists but has zero entries.
	if (!hasManifest) {
		clearDataRoot(dataRoot);
	}

	const collectionNamesMap = new Map(
		collectionRows.map((r) => [r.collection_id, r.name]),
	);
	const renamedCollections = findRenamedCollections(
		manifestData.collectionNames,
		collectionNamesMap,
	);
	const entriesChanged = !manifestsEqual(manifestData.entries, remoteManifest);

	if (!entriesChanged && renamedCollections.size === 0) {
		return false;
	}

	const localMap = new Map(
		manifestData.entries.map((entry) => [entry.document_id, entry]),
	);
	const remoteMap = new Map(
		remoteManifest.map((entry) => [entry.document_id, entry]),
	);

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

	for (const entry of manifestData.entries) {
		if (!remoteMap.has(entry.document_id)) {
			deletes.push(entry);
		}
	}

	if (renamedCollections.size > 0) {
		const updateSet = new Set(updates);
		for (const entry of remoteManifest) {
			if (updateSet.has(entry.document_id)) continue;
			if (entry.collections.some((id) => renamedCollections.has(id))) {
				updates.push(entry.document_id);
				updateSet.add(entry.document_id);
			}
		}
	}

	const changedIds = [...creates, ...updates];
	const changedFiles = await getFileContents(userId, changedIds);

	// Handle deletes
	for (const entry of deletes) {
		if (entry.collections.length > 0) {
			removeCollectionEntries(dataRoot, entry, entry.collections);
		}
		removeCanonicalFile(dataRoot, entry);
	}

	// Handle creates/updates
	for (const file of changedFiles) {
		const local = localMap.get(file.document_id);
		if (local) {
			if (local.type !== file.type) {
				removeCanonicalFile(dataRoot, local);
			}
			if (local.collections.length > 0) {
				removeCollectionEntries(dataRoot, local, local.collections);
			}
		}

		const doc: DocFile = {
			document_id: file.document_id,
			type: file.type,
			collections: file.collections,
			content: file.content,
			checksum: file.checksum,
			title: file.title,
		};
		writeCanonicalFile(dataRoot, doc, collectionNamesMap);

		for (const colId of file.collections) {
			buildCollectionHardlink(dataRoot, doc, colId);
		}
	}

	await Promise.all([
		writeManifest(dataRoot, {
			entries: remoteManifest,
			collectionNames: Object.fromEntries(collectionNamesMap),
		}),
		writeIndexFile(dataRoot, remoteManifest, collectionNamesMap),
	]);

	return true;
}
