import {
	platformCollection,
	platformKnowledge,
	platformKnowledgeCollection,
} from "@mymemo/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./db";

export interface DocMetaRow {
	document_id: string;
	type: number;
	title: string | null;
	updated_at: string;
}

export interface DocContentRow extends DocMetaRow {
	content: string;
}

export interface MembershipRow {
	document_id: string;
	collection_id: string;
	collection_name: string;
	updated_at: string;
}

/**
 * Coalesced title expression: prefer explicit title, fall back to summary_title,
 * then file_name. Empty strings (the DB's "null" sentinel) count as missing.
 */
const coalescedTitleExpr =
	sql<string>`COALESCE(NULLIF(${platformKnowledge.title}, ''), NULLIF(${platformKnowledge.summaryTitle}, ''), NULLIF(${platformKnowledge.fileName}, ''))`;

/**
 * Coalesced content expression: processed `content` preferred; fall back to raw `parse_content`.
 */
const coalescedContentExpr =
	sql<string>`COALESCE(NULLIF(${platformKnowledge.content}, ''), ${platformKnowledge.parseContent})`;

/**
 * The daemon's `document_id` is the stringified `platform_knowledge.id` (bigint),
 * because that's what the chat-api's citation pipeline uses as `summaryId`
 * (see `search-knowledge.ts` and `read-file.ts`). The `doc_id` text column on
 * platform_knowledge is a separate legacy identifier and is NOT interchangeable.
 */
const idAsTextExpr = sql<string>`${platformKnowledge.id}::text`;

/**
 * Metadata-only row for every live document owned by the given member.
 */
export async function getAllDocMeta(
	memberCode: string,
): Promise<DocMetaRow[]> {
	return await getDb()
		.select({
			document_id: idAsTextExpr,
			type: platformKnowledge.type,
			title: coalescedTitleExpr,
			updated_at: platformKnowledge.updateTime,
		})
		.from(platformKnowledge)
		.where(
			and(
				eq(platformKnowledge.memberCode, memberCode),
				eq(platformKnowledge.delFlag, "0"),
			),
		);
}

/**
 * Full rows (metadata + content) for a batch of documents.
 * `documentIds` are stringified `platform_knowledge.id` values (bigint text).
 */
export async function getDocContents(
	memberCode: string,
	documentIds: string[],
): Promise<DocContentRow[]> {
	if (documentIds.length === 0) return [];
	// Convert string IDs to BigInt for exact match — bigint ids can exceed
	// Number.MAX_SAFE_INTEGER and would lose precision if cast to number.
	const bigIntIds = documentIds.map((id) => BigInt(id));
	return await getDb()
		.select({
			document_id: idAsTextExpr,
			type: platformKnowledge.type,
			title: coalescedTitleExpr,
			updated_at: platformKnowledge.updateTime,
			content: coalescedContentExpr,
		})
		.from(platformKnowledge)
		.where(
			and(
				eq(platformKnowledge.memberCode, memberCode),
				eq(platformKnowledge.delFlag, "0"),
				inArray(platformKnowledge.id, bigIntIds),
			),
		);
}

/**
 * One row per (document, collection) membership, with the collection's display
 * name denormalized. `updated_at` is the greater of the membership's create_time
 * and the collection's update_time, so collection renames bubble up and invalidate
 * _index.md on the next reconcile.
 */
export async function getAllMemberships(
	memberCode: string,
): Promise<MembershipRow[]> {
	return await getDb()
		.select({
			document_id: idAsTextExpr,
			collection_id: sql<string>`COALESCE(${platformCollection.compatId}, ${platformCollection.id}::text)`,
			collection_name: platformCollection.name,
			updated_at: sql<string>`GREATEST(${platformCollection.updateTime}, ${platformKnowledgeCollection.createTime})`,
		})
		.from(platformKnowledgeCollection)
		.innerJoin(
			platformKnowledge,
			eq(platformKnowledge.id, platformKnowledgeCollection.knowledgeId),
		)
		.innerJoin(
			platformCollection,
			eq(platformCollection.id, platformKnowledgeCollection.collectionId),
		)
		.where(
			and(
				eq(platformKnowledge.memberCode, memberCode),
				eq(platformKnowledge.delFlag, "0"),
				eq(platformCollection.delFlag, "0"),
			),
		);
}
