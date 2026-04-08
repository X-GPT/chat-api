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

	// Collect all collection IDs while diffing the manifest
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
		} else if (local.checksum !== entry.checksum) {
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

	const deleteAffectedCollections = new Set<string>();
	for (const entry of deletes) {
		const collectionIds = parseCollectionIds(entry.path_key);
		if (collectionIds.length > 0) {
			removeCollectionEntries(
				dataRoot,
				{ type: entry.type, slug: entry.slug },
				collectionIds,
			);
			for (const colId of collectionIds) {
				deleteAffectedCollections.add(colId);
			}
		}
		removeCanonicalFile(dataRoot, { type: entry.type, slug: entry.slug });
	}

	const collectionMap = new Map<
		string,
		Array<{ document_id: string; type: number; slug: string }>
	>();

	for (const file of changedFiles) {
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
			if (!collectionMap.has(colId)) {
				collectionMap.set(colId, []);
			}
			collectionMap.get(colId)?.push({
				document_id: file.document_id,
				type: file.type,
				slug: file.slug,
			});
		}
	}

	for (const [colId, docs] of collectionMap) {
		buildCollectionIndex(dataRoot, colId, docs);
	}

	// Rebuild indexes for collections affected by deletes
	for (const colId of deleteAffectedCollections) {
		if (!collectionMap.has(colId)) {
			const remainingDocs = remoteManifest
				.filter((e) => parseCollectionIds(e.path_key).includes(colId))
				.map((e) => ({
					document_id: e.document_id,
					type: e.type,
					slug: e.slug,
				}));
			buildCollectionIndex(dataRoot, colId, remainingDocs);
		}
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
