import {
	buildCanonicalPath,
	buildCollectionHardlink,
	ensureDataRoot,
	getDataRoot,
	getMtimeSeconds,
	removeCanonicalFile,
	removeCollectionHardlink,
	scanCanonicalFiles,
	scanCollectionLinks,
	stampMtime,
	stampMtimeSeconds,
	toEpochSeconds,
	writeCanonicalFile,
	writeIndexFile,
} from "./materialization";
import {
	getAllDocMeta,
	getAllMemberships,
	getDocContents,
} from "./queries";

interface ReconcileInput {
	userId: string;
}

/**
 * Reconcile the local filesystem state with the database.
 *
 * Three independent streams, each with a filesystem-native marker:
 *  - Canonical files: mtime of canonical/{type}/{id}.md vs user_files.updated_at
 *  - Hardlinks: existence of collections/{col}/{type}/{id}.md vs file_collection_relationship rows
 *  - _index.md: mtime vs max(file_collection_relationship.updated_at)
 *
 * Returns true if any disk change was made, false if everything was already in sync.
 */
export async function reconcile(input: ReconcileInput): Promise<boolean> {
	const { userId } = input;
	const dataRoot = getDataRoot(userId);
	ensureDataRoot(dataRoot);

	const [docs, memberships] = await Promise.all([
		getAllDocMeta(userId),
		getAllMemberships(userId),
	]);

	// 1. Canonical files: per-file mtime diff.
	const wantedDocKeys = new Set<string>();
	const docTypeById = new Map<string, number>();
	const changedIds: string[] = [];
	for (const d of docs) {
		wantedDocKeys.add(`${d.type}/${d.document_id}`);
		docTypeById.set(d.document_id, d.type);
		const path = buildCanonicalPath(dataRoot, d);
		if (getMtimeSeconds(path) !== toEpochSeconds(d.updated_at)) {
			changedIds.push(d.document_id);
		}
	}

	let docsMutated = false;
	if (changedIds.length > 0) {
		const contents = await getDocContents(userId, changedIds);
		for (const c of contents) {
			writeCanonicalFile(dataRoot, {
				document_id: c.document_id,
				type: c.type,
				content: c.content,
				title: c.title,
			});
			stampMtime(buildCanonicalPath(dataRoot, c), c.updated_at);
		}
		docsMutated = true;
	}

	// 2. Orphan cleanup for canonical/ — catches deletes and the stale side of
	//    a type change in one pass.
	for (const file of scanCanonicalFiles(dataRoot)) {
		if (!wantedDocKeys.has(`${file.type}/${file.document_id}`)) {
			removeCanonicalFile(dataRoot, file);
			docsMutated = true;
		}
	}

	// 3. Hardlinks: existence-based diff.
	const wantedLinks = new Set<string>();
	for (const m of memberships) {
		const type = docTypeById.get(m.document_id);
		if (type === undefined) continue; // membership for a deleted doc
		wantedLinks.add(`${m.collection_id}/${type}/${m.document_id}`);
	}

	let linksMutated = false;
	const existingLinks = scanCollectionLinks(dataRoot);
	const existingSet = new Set<string>();
	for (const l of existingLinks) {
		const key = `${l.collection_id}/${l.type}/${l.document_id}`;
		existingSet.add(key);
		if (!wantedLinks.has(key)) {
			removeCollectionHardlink(dataRoot, l, l.collection_id);
			linksMutated = true;
		}
	}
	for (const m of memberships) {
		const type = docTypeById.get(m.document_id);
		if (type === undefined) continue;
		const key = `${m.collection_id}/${type}/${m.document_id}`;
		if (!existingSet.has(key)) {
			buildCollectionHardlink(
				dataRoot,
				{ document_id: m.document_id, type },
				m.collection_id,
			);
			linksMutated = true;
		}
	}

	// 4. _index.md: mtime vs max-membership-updated-at.
	const indexPath = `${dataRoot}/canonical/_index.md`;
	let maxMembershipSec = 0;
	for (const m of memberships) {
		const sec = toEpochSeconds(m.updated_at);
		if (sec > maxMembershipSec) maxMembershipSec = sec;
	}

	const indexNeedsRewrite =
		docsMutated ||
		linksMutated ||
		getMtimeSeconds(indexPath) !== maxMembershipSec;

	if (indexNeedsRewrite) {
		await writeIndexFile(dataRoot, docs, memberships);
		stampMtimeSeconds(indexPath, maxMembershipSec);
	}

	return docsMutated || linksMutated || indexNeedsRewrite;
}
