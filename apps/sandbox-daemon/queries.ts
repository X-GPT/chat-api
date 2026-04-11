import { userFiles } from "@mymemo/db";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import type { LocalManifestEntry } from "./state";

export interface FileContentRow extends LocalManifestEntry {
	content: string;
}

export async function getManifest(
	userId: string,
): Promise<LocalManifestEntry[]> {
	return getDb()
		.select({
			document_id: userFiles.documentId,
			type: userFiles.type,
			path_key: userFiles.pathKey,
			checksum: userFiles.checksum,
		})
		.from(userFiles)
		.where(eq(userFiles.userId, userId))
		.orderBy(userFiles.documentId);
}

export async function getFileContents(
	userId: string,
	documentIds: string[],
): Promise<FileContentRow[]> {
	if (documentIds.length === 0) return [];
	return getDb()
		.select({
			document_id: userFiles.documentId,
			type: userFiles.type,
			path_key: userFiles.pathKey,
			content: userFiles.content,
			checksum: userFiles.checksum,
		})
		.from(userFiles)
		.where(
			and(
				eq(userFiles.userId, userId),
				inArray(userFiles.documentId, documentIds),
			),
		);
}
