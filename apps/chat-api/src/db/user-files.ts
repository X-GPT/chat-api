import { query } from "./client";

export interface UserFileManifestEntry {
	document_id: string;
	type: number;
	slug: string;
	path_key: string;
	checksum: string;
}

export interface UserFileRow {
	user_id: string;
	document_id: string;
	type: number;
	slug: string;
	path_key: string;
	content: string;
	checksum: string;
	updated_at: string;
}

/**
 * Fetch manifest (metadata only, no content) for a user's files.
 */
export async function getManifest(
	userId: string,
): Promise<UserFileManifestEntry[]> {
	return query<UserFileManifestEntry>(
		`SELECT document_id, type, slug, path_key, checksum
		 FROM user_files
		 WHERE user_id = $1
		 ORDER BY document_id`,
		[userId],
	);
}

/**
 * Fetch full file rows (with content) for specific document IDs.
 */
export async function getFileContents(
	userId: string,
	documentIds: string[],
): Promise<UserFileRow[]> {
	if (documentIds.length === 0) return [];

	return query<UserFileRow>(
		`SELECT user_id, document_id, type, slug, path_key, content, checksum, updated_at::text
		 FROM user_files
		 WHERE user_id = $1 AND document_id = ANY($2)`,
		[userId, documentIds],
	);
}

/**
 * Fetch all files with content for a user (used for initial sync).
 */
export async function getAllFiles(userId: string): Promise<UserFileRow[]> {
	return query<UserFileRow>(
		`SELECT user_id, document_id, type, slug, path_key, content, checksum, updated_at::text
		 FROM user_files
		 WHERE user_id = $1
		 ORDER BY document_id`,
		[userId],
	);
}
