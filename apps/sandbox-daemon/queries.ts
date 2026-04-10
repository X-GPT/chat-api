import { userFiles, userSandboxRuntime } from "@mymemo/db";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";

export interface ManifestRow {
	document_id: string;
	type: number;
	slug: string;
	path_key: string;
	checksum: string;
}

export interface FileContentRow extends ManifestRow {
	content: string;
}

export async function getStateVersion(userId: string): Promise<number> {
	const rows = await getDb()
		.select({ state_version: userSandboxRuntime.stateVersion })
		.from(userSandboxRuntime)
		.where(eq(userSandboxRuntime.userId, userId));
	return rows[0]?.state_version ?? 0;
}

export async function getManifest(userId: string): Promise<ManifestRow[]> {
	return getDb()
		.select({
			document_id: userFiles.documentId,
			type: userFiles.type,
			slug: userFiles.slug,
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
			slug: userFiles.slug,
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
