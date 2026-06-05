import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { type LlmTokenClaims, mintLlmToken } from "@mymemo/llm-token";
import type { Db } from "./db";

const SECRET = "test-secret";

let app: typeof import("./index").app;
let setDbForTests: typeof import("./index").setDbForTests;

beforeAll(async () => {
	Bun.env.LLM_TOKEN_SECRET = SECRET;
	Bun.env.DATABASE_URL = "postgres://test@localhost/test";
	({ app, setDbForTests } = await import("./index"));
});

function token(extra: Partial<Omit<LlmTokenClaims, "exp">> = {}): string {
	return mintLlmToken(
		{ userId: "u1", sandboxId: "sbx", requestId: "req", ...extra },
		SECRET,
	);
}

function headers(t: string): Record<string, string> {
	return { authorization: `Bearer ${t}`, "content-type": "application/json" };
}

// Fake Db: records every query and replies via a per-test responder keyed off
// the SQL. Lets us assert the exact scope filters without a live Postgres.
interface Call {
	text: string;
	params: unknown[];
}
let calls: Call[] = [];
let responder: (text: string, params: unknown[]) => unknown[];

const fakeDb: Db = {
	async query<T>(text: string, params: unknown[] = []): Promise<T[]> {
		calls.push({ text, params });
		return responder(text, params) as T[];
	},
};

function kind(text: string): "search" | "resolveDoc" | "resolveColl" | "fetch" {
	if (text.includes("ts_rank_cd")) return "search";
	if (text.includes("FROM content_asset")) return "resolveDoc";
	if (text.includes("content_collection")) return "resolveColl";
	return "fetch";
}
const callOf = (k: ReturnType<typeof kind>) =>
	calls.find((c) => kind(c.text) === k);

beforeAll(() => setDbForTests(fakeDb));
afterEach(() => {
	calls = [];
	responder = () => [];
});

describe("document-gateway (FTS / Postgres)", () => {
	it("rejects requests without a valid token (no DB touched)", async () => {
		const res = await app.request("/v1/documents/search", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ query: "x" }),
		});
		expect(res.status).toBe(401);
		expect(calls).toHaveLength(0);
	});

	it("rejects search when the token has no scope (fail closed)", async () => {
		const res = await app.request("/v1/documents/search", {
			method: "POST",
			headers: headers(token()),
			body: JSON.stringify({ query: "x" }),
		});
		expect(res.status).toBe(403);
		expect(calls).toHaveLength(0);
	});

	it("global search pins workspace_id to the token userId and no doc filter", async () => {
		responder = (t) =>
			kind(t) === "search"
				? [{ passage_id: "p1", document_id: "d1", title: "T", snippet: "S" }]
				: [];
		const res = await app.request("/v1/documents/search", {
			method: "POST",
			headers: headers(token({ scope: "global" })),
			body: JSON.stringify({ query: "hello world" }),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			documents: [
				{ passageId: "p1", documentId: "d1", title: "T", snippet: "S" },
			],
		});
		const search = callOf("search");
		expect(search?.params[0]).toBe("u1"); // workspace_id
		expect(search?.params[1]).toBe("hello world");
		expect(search?.params[2]).toBeNull(); // no document filter in global scope
	});

	it("document search resolves summaryId and restricts to that document", async () => {
		responder = (t) => {
			if (kind(t) === "resolveDoc") return [{ kb_document_id: "kb-doc-9" }];
			if (kind(t) === "search")
				return [
					{ passage_id: "p", document_id: "kb-doc-9", title: "", snippet: "" },
				];
			return [];
		};
		await app.request("/v1/documents/search", {
			method: "POST",
			headers: headers(token({ scope: "document", summaryId: "42" })),
			body: JSON.stringify({ query: "x" }),
		});
		expect(callOf("resolveDoc")?.params).toEqual(["42", "u1"]);
		expect(callOf("search")?.params[2]).toEqual(["kb-doc-9"]);
	});

	it("document search with an unknown summaryId returns empty, no search", async () => {
		responder = () => []; // resolveDoc finds nothing
		const res = await app.request("/v1/documents/search", {
			method: "POST",
			headers: headers(token({ scope: "document", summaryId: "999" })),
			body: JSON.stringify({ query: "x" }),
		});
		expect(await res.json()).toEqual({ documents: [] });
		expect(callOf("search")).toBeUndefined();
	});

	it("collection search restricts to the collection's documents", async () => {
		responder = (t) => {
			if (kind(t) === "resolveColl")
				return [{ document_id: "d1" }, { document_id: "d2" }];
			if (kind(t) === "search") return [];
			return [];
		};
		await app.request("/v1/documents/search", {
			method: "POST",
			headers: headers(token({ scope: "collection", collectionId: "col-1" })),
			body: JSON.stringify({ query: "x" }),
		});
		expect(callOf("resolveColl")?.params).toEqual(["col-1", "u1"]);
		expect(callOf("search")?.params[2]).toEqual(["d1", "d2"]);
	});

	it("collection search with an empty collection returns empty, no search", async () => {
		responder = () => [];
		const res = await app.request("/v1/documents/search", {
			method: "POST",
			headers: headers(token({ scope: "collection", collectionId: "col-x" })),
			body: JSON.stringify({ query: "x" }),
		});
		expect(await res.json()).toEqual({ documents: [] });
		expect(callOf("search")).toBeUndefined();
	});

	it("global fetch returns the document pinned to the workspace", async () => {
		responder = (t) =>
			kind(t) === "fetch"
				? [{ document_id: "d1", title: "T", content: "body" }]
				: [];
		const res = await app.request("/v1/documents/fetch", {
			method: "POST",
			headers: headers(token({ scope: "global" })),
			body: JSON.stringify({ documentId: "d1" }),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			documentId: "d1",
			title: "T",
			content: "body",
		});
		expect(callOf("fetch")?.params).toEqual(["d1", "u1"]);
	});

	it("document-scope fetch rejects an out-of-scope documentId (no fetch)", async () => {
		responder = (t) =>
			kind(t) === "resolveDoc" ? [{ kb_document_id: "kb-doc-9" }] : [];
		const res = await app.request("/v1/documents/fetch", {
			method: "POST",
			headers: headers(token({ scope: "document", summaryId: "42" })),
			body: JSON.stringify({ documentId: "kb-doc-other" }),
		});
		expect(res.status).toBe(403);
		expect(callOf("fetch")).toBeUndefined();
	});

	it("document-scope fetch allows the in-scope documentId", async () => {
		responder = (t) => {
			if (kind(t) === "resolveDoc") return [{ kb_document_id: "kb-doc-9" }];
			if (kind(t) === "fetch")
				return [{ document_id: "kb-doc-9", title: "T", content: "c" }];
			return [];
		};
		const res = await app.request("/v1/documents/fetch", {
			method: "POST",
			headers: headers(token({ scope: "document", summaryId: "42" })),
			body: JSON.stringify({ documentId: "kb-doc-9" }),
		});
		expect(res.status).toBe(200);
	});

	it("collection-scope fetch rejects a document outside the collection", async () => {
		responder = (t) =>
			kind(t) === "resolveColl" ? [{ document_id: "d1" }] : [];
		const res = await app.request("/v1/documents/fetch", {
			method: "POST",
			headers: headers(token({ scope: "collection", collectionId: "col-1" })),
			body: JSON.stringify({ documentId: "d2" }),
		});
		expect(res.status).toBe(403);
		expect(callOf("fetch")).toBeUndefined();
	});

	it("returns 404 when the document is missing / not in the workspace", async () => {
		responder = () => []; // fetch finds nothing
		const res = await app.request("/v1/documents/fetch", {
			method: "POST",
			headers: headers(token({ scope: "global" })),
			body: JSON.stringify({ documentId: "nope" }),
		});
		expect(res.status).toBe(404);
	});
});
