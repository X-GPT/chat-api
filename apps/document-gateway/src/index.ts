import { type LlmTokenClaims, verifyLlmToken } from "@mymemo/llm-token";
import { type Context, Hono } from "hono";
import { gwEnv } from "./env";

/**
 * Document gateway — the trusted control plane for sandboxed-agent document
 * access.
 *
 * The sandboxed agent calls this service (via the `mymemo-docs` CLI) with a
 * short-lived per-turn Bearer token. The agent holds no document-API
 * credential: we verify the token, ENFORCE the turn's scope server-side, then
 * call the real MyMemo document API with the real key (always pinned to the
 * token's userId — never a client-supplied id).
 *
 * Scope is signed into the token, so a prompt-injected agent cannot widen it:
 *   - global     → search/fetch any of the user's own documents
 *   - collection → search forced to collectionId; fetch must be in collectionId
 *   - document   → search disabled; fetch must equal summaryId
 *
 * TODO(doc-api-contract, #117): the upstream endpoints + request/response shapes
 * below are ASSUMED. Confirm them against the real MyMemo document API and adjust.
 */

export const app = new Hono();

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

/** GET the upstream MyMemo document API, authenticated with the real key. */
async function docApiGet(path: string, qs: URLSearchParams): Promise<Response> {
	const query = qs.toString();
	const url = `${gwEnv.MYMEMO_DOC_API_URL}${path}${query ? `?${query}` : ""}`;
	return fetch(url, {
		headers: { authorization: `Bearer ${gwEnv.MYMEMO_DOC_API_KEY}` },
	});
}

interface FetchedDocument {
	documentId: string;
	title?: string;
	content?: string;
	cite?: string;
	collections?: string[];
}

app.post("/v1/documents/search", async (c) => {
	const claims = bearerClaims(c);
	if (!claims) return unauthorized(c);
	if (!isKnownScope(claims.scope)) return forbidden(c, "unknown scope");

	const body = await c.req
		.json<{ query?: string; collectionId?: string }>()
		.catch(() => ({}) as { query?: string; collectionId?: string });
	if (!body.query) return c.json({ error: "query is required" }, 400);

	// Server-side scope enforcement — never trust the agent's collectionId.
	if (claims.scope === "document") {
		// In document scope there is nothing to search; the agent must fetch the
		// one in-scope document directly.
		return c.json({ documents: [] });
	}
	const qs = new URLSearchParams({ q: body.query });
	if (claims.scope === "collection") {
		qs.set("collection", claims.collectionId ?? "");
	} else if (body.collectionId) {
		// global scope: an optional narrowing within the user's own documents.
		qs.set("collection", body.collectionId);
	}

	// Upstream call is pinned to the token's userId.
	const upstream = await docApiGet(
		`/users/${encodeURIComponent(claims.userId)}/documents`,
		qs,
	).catch(() => null);
	if (!upstream || !upstream.ok) {
		return c.json({ error: "document search failed" }, 502);
	}
	return c.json(await upstream.json());
});

app.post("/v1/documents/fetch", async (c) => {
	const claims = bearerClaims(c);
	if (!claims) return unauthorized(c);
	if (!isKnownScope(claims.scope)) return forbidden(c, "unknown scope");

	const body = await c.req
		.json<{ documentId?: string }>()
		.catch(() => ({}) as { documentId?: string });
	if (!body.documentId) return c.json({ error: "documentId is required" }, 400);

	// Document scope: the agent may fetch only the single in-scope document.
	if (claims.scope === "document" && body.documentId !== claims.summaryId) {
		return forbidden(c, "document out of scope");
	}

	const upstream = await docApiGet(
		`/users/${encodeURIComponent(claims.userId)}/documents/${encodeURIComponent(body.documentId)}`,
		new URLSearchParams(),
	).catch(() => null);
	if (!upstream) return c.json({ error: "document fetch failed" }, 502);
	if (upstream.status === 404) return c.json({ error: "not found" }, 404);
	if (!upstream.ok) return c.json({ error: "document fetch failed" }, 502);

	const doc = (await upstream.json()) as FetchedDocument;

	// Collection scope: the fetched document must belong to the in-scope
	// collection (the upstream call only enforces user ownership).
	if (
		claims.scope === "collection" &&
		!doc.collections?.includes(claims.collectionId ?? "")
	) {
		return forbidden(c, "document not in collection");
	}

	return c.json(doc);
});

export default {
	port: gwEnv.DOCUMENT_GATEWAY_PORT,
	fetch: app.fetch,
};
