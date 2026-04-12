import {
	buildCollectionHardlink,
	type DocFile,
	deriveLocalManifest,
	getDataRoot,
	type LocalManifestEntry,
	removeCanonicalFile,
	removeCollectionEntries,
	writeCanonicalFile,
} from "./materialization";
import { getFileContents, getManifest } from "./queries";

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
		!collectionsEqual(local.collections, remote.collections)
	);
}

// Assumes both sides are ordered by document_id. Enforced by
// getManifest()'s ORDER BY and by deriveLocalManifest's sort.
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
	const localManifest = await deriveLocalManifest(dataRoot);

	if (manifestsEqual(localManifest, remoteManifest)) {
		return false;
	}

	const localMap = new Map(
		localManifest.map((entry) => [entry.document_id, entry]),
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

	for (const entry of localManifest) {
		if (!remoteMap.has(entry.document_id)) {
			deletes.push(entry);
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
			// If type changed, canonical path changed — remove old file
			if (local.type !== file.type) {
				removeCanonicalFile(dataRoot, local);
			}
			// Clean up old collection hardlinks
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
		};
		writeCanonicalFile(dataRoot, doc);

		for (const colId of file.collections) {
			buildCollectionHardlink(dataRoot, doc, colId);
		}
	}

	return true;
}
