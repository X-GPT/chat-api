import type { Db } from "./db";

/**
 * Read-side of the MyMemo knowledge base, FTS-only (no dense/vector, no rerank).
 *
 * Scope mapping (derived from the platform's compat layer):
 *   - workspace_id  = the user's member_code (personal workspace)
 *   - summaryId     = platform_knowledge.id = content_asset.compat_int_id
 *                     → content_asset.kb_document_id = document.id
 *   - collectionId  = platform_collection.compat_id = content_collection.compat_str_id
 *                     → content_collection.compat_int_id = passage_collection.collection_id
 */

export interface SearchHit {
	passageId: string;
	documentId: string;
	title: string;
	snippet: string;
}

export interface FetchedDocument {
	documentId: string;
	title: string;
	content: string;
}

/**
 * Lexical full-text search over passages, scoped to a workspace and (optionally)
 * a set of document ids. Uses the precomputed `search_tsv` column with the
 * `simple` config — no language detection / CJK tokenization (FTS-only).
 */
export async function searchPassages(
	db: Db,
	opts: {
		workspaceId: string;
		query: string;
		documentIds: string[] | null;
		limit: number;
	},
): Promise<SearchHit[]> {
	// Build the optional document filter with one bind param per id — Bun.sql
	// does not bind a JS array to a Postgres text[] (it sends "a,b", not "{a,b}"),
	// so `= ANY($n)` is unusable. `IN ($3,$4,…)` keeps every id a scalar param.
	const params: unknown[] = [opts.workspaceId, opts.query];
	let docFilter = "";
	if (opts.documentIds) {
		if (opts.documentIds.length === 0) return [];
		const slots = opts.documentIds
			.map((_, i) => `$${params.length + i + 1}`)
			.join(", ");
		params.push(...opts.documentIds);
		docFilter = `AND p.document_id IN (${slots})`;
	}
	const limitSlot = `$${params.length + 1}`;
	params.push(opts.limit);

	const rows = await db.query<{
		passage_id: string;
		document_id: string;
		title: string;
		snippet: string;
	}>(
		`SELECT p.id AS passage_id, p.document_id, d.title,
		        left(p.passage_text, 220) AS snippet,
		        ts_rank_cd(p.search_tsv, plainto_tsquery('simple', $2)) AS score
		   FROM passage p
		   JOIN document d ON d.id = p.document_id
		  WHERE p.workspace_id = $1
		    AND p.status = 'active'
		    AND d.status = 'active'
		    ${docFilter}
		    AND p.search_tsv @@ plainto_tsquery('simple', $2)
		  ORDER BY score DESC
		  LIMIT ${limitSlot}`,
		params,
	);
	return rows.map((r) => ({
		passageId: r.passage_id,
		documentId: r.document_id,
		title: r.title ?? "",
		snippet: r.snippet ?? "",
	}));
}

/** Fetch a single document's full content, pinned to the workspace. */
export async function fetchDocument(
	db: Db,
	opts: { workspaceId: string; documentId: string },
): Promise<FetchedDocument | null> {
	const rows = await db.query<{
		document_id: string;
		title: string;
		content: string;
	}>(
		// Clip to 50k chars (matches the production read_document) so a large
		// document can't dump hundreds of KB into the agent's context.
		`SELECT id AS document_id, title, left(canonical_markdown, 50000) AS content
		   FROM document
		  WHERE id = $1 AND workspace_id = $2 AND status = 'active'
		  LIMIT 1`,
		[opts.documentId, opts.workspaceId],
	);
	const row = rows[0];
	if (!row) return null;
	return {
		documentId: row.document_id,
		title: row.title ?? "",
		content: row.content ?? "",
	};
}

/**
 * Document scope: resolve the turn's summaryId (= platform_knowledge.id) to the
 * KB document.id, pinned to the user's member_code. Returns null if not found.
 */
export async function resolveDocumentId(
	db: Db,
	opts: { summaryId: string; memberCode: string },
): Promise<string | null> {
	// summaryId is platform_knowledge.id (a bigint). Fail closed on anything
	// non-numeric rather than letting `$1::bigint` raise a SQL error.
	if (!/^\d+$/.test(opts.summaryId)) return null;
	const rows = await db.query<{ kb_document_id: string }>(
		`SELECT kb_document_id
		   FROM content_asset
		  WHERE compat_int_id = $1::bigint
		    AND member_code = $2
		    AND kb_document_id <> ''
		  LIMIT 1`,
		[opts.summaryId, opts.memberCode],
	);
	return rows[0]?.kb_document_id ?? null;
}

/**
 * Collection scope: resolve the turn's collectionId (= content_collection
 * compat_str_id) to the KB document ids in that collection, pinned to the
 * workspace. Returns [] if the collection is unknown or empty.
 *
 * User scoping is the `p.workspace_id = $2` pin, NOT `content_collection
 * .member_code` (which is stored in a different representation — verified
 * against staging: pinning by workspace returns the collection's docs and a
 * cross-workspace collectionId yields nothing).
 */
export async function resolveCollectionDocumentIds(
	db: Db,
	opts: { collectionId: string; workspaceId: string },
): Promise<string[]> {
	const rows = await db.query<{ document_id: string }>(
		`SELECT DISTINCT p.document_id
		   FROM content_collection c
		   JOIN passage_collection pc ON pc.collection_id = c.compat_int_id::text
		   JOIN passage p ON p.id = pc.passage_id
		  WHERE c.compat_str_id = $1
		    AND p.workspace_id = $2
		    AND p.status = 'active'`,
		[opts.collectionId, opts.workspaceId],
	);
	return rows.map((r) => r.document_id);
}
