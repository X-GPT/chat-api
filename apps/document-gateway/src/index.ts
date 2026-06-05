import { type LlmTokenClaims, verifyLlmToken } from "@mymemo/llm-token";
import { type Context, Hono } from "hono";
import { type Db, getDb } from "./db";
import { gwEnv } from "./env";
import {
	fetchDocument,
	resolveCollectionDocumentIds,
	resolveDocumentId,
	searchPassages,
} from "./queries";

/**
 * Document gateway — the trusted control plane for sandboxed-agent document
 * access. It reads the MyMemo knowledge base (Postgres) directly and ENFORCES
 * the turn's signed scope server-side, so a prompt-injected agent cannot widen
 * it. Search is FTS-only (lexical `search_tsv`); no dense/vector or rerank.
 *
 * The user's workspace is their member_code (= token userId); scope narrows it:
 *   - global     → search/fetch any document in the workspace
 *   - collection → restricted to documents in the turn's collection
 *   - document   → restricted to the single document (summaryId)
 */

export const app = new Hono();

const SEARCH_LIMIT = 8;

// Test seam: inject a fake Db so query logic is exercised without a live RDS.
let testDb: Db | null = null;
export function setDbForTests(d: Db | null): void {
	testDb = d;
}
function db(): Db {
	return testDb ?? getDb();
}

app.on(["GET", "HEAD"], "/health", (c) => c.json({ status: "ok" }));

function bearerClaims(c: Context): LlmTokenClaims | null {
	const auth = c.req.header("authorization")?.trim() ?? "";
	const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1] ?? "";
	return verifyLlmToken(token, gwEnv.LLM_TOKEN_SECRET);
}

function unauthorized(c: Context) {
	return c.json({ error: "invalid or expired token" }, 401);
}

function forbidden(c: Context, message: string) {
	return c.json({ error: message }, 403);
}

/**
 * Fail closed: the gateway is the trust boundary and must not depend on the
 * minter always setting a scope. A token whose scope is absent or unknown is
 * rejected rather than falling through to global access.
 */
function isKnownScope(
	scope: LlmTokenClaims["scope"],
): scope is "global" | "collection" | "document" {
	return scope === "global" || scope === "collection" || scope === "document";
}

app.post("/v1/documents/search", async (c) => {
	const claims = bearerClaims(c);
	if (!claims) return unauthorized(c);
	if (!isKnownScope(claims.scope)) return forbidden(c, "unknown scope");

	const body = await c.req
		.json<{ query?: string }>()
		.catch(() => ({}) as { query?: string });
	if (!body.query) return c.json({ error: "query is required" }, 400);

	const workspaceId = claims.userId;

	// Server-side scope enforcement — narrow the searchable documents.
	let documentIds: string[] | null = null;
	if (claims.scope === "document") {
		const docId = await resolveDocumentId(db(), {
			summaryId: claims.summaryId ?? "",
			memberCode: claims.userId,
		});
		if (!docId) return c.json({ documents: [] });
		documentIds = [docId];
	} else if (claims.scope === "collection") {
		documentIds = await resolveCollectionDocumentIds(db(), {
			collectionId: claims.collectionId ?? "",
			workspaceId,
		});
		if (documentIds.length === 0) return c.json({ documents: [] });
	}

	const documents = await searchPassages(db(), {
		workspaceId,
		query: body.query,
		documentIds,
		limit: SEARCH_LIMIT,
	}).catch(() => null);
	if (!documents) return c.json({ error: "document search failed" }, 502);
	return c.json({ documents });
});

app.post("/v1/documents/fetch", async (c) => {
	const claims = bearerClaims(c);
	if (!claims) return unauthorized(c);
	if (!isKnownScope(claims.scope)) return forbidden(c, "unknown scope");

	const body = await c.req
		.json<{ documentId?: string }>()
		.catch(() => ({}) as { documentId?: string });
	if (!body.documentId) return c.json({ error: "documentId is required" }, 400);

	const workspaceId = claims.userId;

	// Server-side scope enforcement — the document must be in scope.
	if (claims.scope === "document") {
		const docId = await resolveDocumentId(db(), {
			summaryId: claims.summaryId ?? "",
			memberCode: claims.userId,
		});
		if (!docId || body.documentId !== docId) {
			return forbidden(c, "document out of scope");
		}
	} else if (claims.scope === "collection") {
		const allowed = await resolveCollectionDocumentIds(db(), {
			collectionId: claims.collectionId ?? "",
			workspaceId,
		});
		if (!allowed.includes(body.documentId)) {
			return forbidden(c, "document not in collection");
		}
	}

	const doc = await fetchDocument(db(), {
		workspaceId,
		documentId: body.documentId,
	}).catch(() => null);
	if (doc === null) return c.json({ error: "not found" }, 404);
	return c.json(doc);
});

export default {
	port: gwEnv.DOCUMENT_GATEWAY_PORT,
	fetch: app.fetch,
};
