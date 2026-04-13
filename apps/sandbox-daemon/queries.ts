import { userCollections, userFiles } from "@mymemo/db";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { type LocalManifestEntry, parseCollectionIds } from "./materialization";

export interface FileContentRow extends LocalManifestEntry {
	content: string;
}

export async function getManifest(
	userId: string,
): Promise<LocalManifestEntry[]> {
	const rows = await getDb()
		.select({
			document_id: userFiles.documentId,
			type: userFiles.type,
			path_key: userFiles.pathKey,
			checksum: userFiles.checksum,
			title: userFiles.title,
		})
		.from(userFiles)
		.where(eq(userFiles.userId, userId))
		.orderBy(userFiles.documentId);
	return rows.map((row) => ({
		document_id: row.document_id,
		type: row.type,
		checksum: row.checksum,
		collections: parseCollectionIds(row.path_key),
		title: row.title ?? undefined,
	}));
}

export async function getFileContents(
	userId: string,
	documentIds: string[],
): Promise<FileContentRow[]> {
	if (documentIds.length === 0) return [];
	const rows = await getDb()
		.select({
			document_id: userFiles.documentId,
			type: userFiles.type,
			path_key: userFiles.pathKey,
			content: userFiles.content,
			checksum: userFiles.checksum,
			title: userFiles.title,
		})
		.from(userFiles)
		.where(
			and(
				eq(userFiles.userId, userId),
				inArray(userFiles.documentId, documentIds),
			),
		);
	return rows.map((row) => ({
		document_id: row.document_id,
		type: row.type,
		checksum: row.checksum,
		collections: parseCollectionIds(row.path_key),
		content: row.content,
		title: row.title ?? undefined,
	}));
}

export interface CollectionNameRow {
	collection_id: string;
	name: string;
}

export async function getCollectionNames(
	userId: string,
): Promise<CollectionNameRow[]> {
	try {
		return await getDb()
			.select({
				collection_id: userCollections.collectionId,
				name: userCollections.name,
			})
			.from(userCollections)
			.where(eq(userCollections.userId, userId));
	} catch {
		// Table may not exist yet if schema migration hasn't run.
		return [];
	}
}
