import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { type LlmTokenClaims, mintLlmToken } from "@mymemo/llm-token";

const SECRET = "test-secret";
const DOC_API = "https://docs.test";

let app: typeof import("./index").app;

beforeAll(async () => {
	Bun.env.LLM_TOKEN_SECRET = SECRET;
	Bun.env.MYMEMO_DOC_API_URL = DOC_API;
	Bun.env.MYMEMO_DOC_API_KEY = "real-doc-key";
	({ app } = await import("./index"));
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

let fetchSpy: ReturnType<typeof spyOn> | undefined;
function mockUpstream(body: unknown, status = 200) {
	const calls: string[] = [];
	fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
		url: string | URL | Request,
	) => {
		calls.push(String(url));
		return new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});
	}) as unknown as typeof fetch);
	return calls;
}

afterEach(() => {
	fetchSpy?.mockRestore();
	fetchSpy = undefined;
});

describe("document-gateway", () => {
	it("rejects requests without a valid token", async () => {
		const calls = mockUpstream({});
		const res = await app.request("/v1/documents/search", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ query: "x" }),
		});
		expect(res.status).toBe(401);
		expect(calls).toHaveLength(0);
	});

	it("global search pins the upstream call to the token userId", async () => {
		const calls = mockUpstream({ documents: [{ documentId: "d1" }] });
		const res = await app.request("/v1/documents/search", {
			method: "POST",
			headers: headers(token({ scope: "global" })),
			body: JSON.stringify({ query: "hello world" }),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ documents: [{ documentId: "d1" }] });
		expect(calls[0]).toContain("/users/u1/documents");
		expect(calls[0]).toContain("q=hello+world");
	});

	it("collection search forces the token collectionId, ignoring the body", async () => {
		const calls = mockUpstream({ documents: [] });
		await app.request("/v1/documents/search", {
			method: "POST",
			headers: headers(token({ scope: "collection", collectionId: "col-1" })),
			body: JSON.stringify({ query: "x", collectionId: "col-evil" }),
		});
		expect(calls[0]).toContain("collection=col-1");
		expect(calls[0]).not.toContain("col-evil");
	});

	it("document-scope search is disabled and never hits upstream", async () => {
		const calls = mockUpstream({ documents: [{ documentId: "leak" }] });
		const res = await app.request("/v1/documents/search", {
			method: "POST",
			headers: headers(token({ scope: "document", summaryId: "d-1" })),
			body: JSON.stringify({ query: "x" }),
		});
		expect(await res.json()).toEqual({ documents: [] });
		expect(calls).toHaveLength(0);
	});

	it("document-scope fetch rejects an out-of-scope documentId", async () => {
		const calls = mockUpstream({ documentId: "d-other" });
		const res = await app.request("/v1/documents/fetch", {
			method: "POST",
			headers: headers(token({ scope: "document", summaryId: "d-allowed" })),
			body: JSON.stringify({ documentId: "d-other" }),
		});
		expect(res.status).toBe(403);
		expect(calls).toHaveLength(0);
	});

	it("document-scope fetch allows the in-scope documentId", async () => {
		mockUpstream({
			documentId: "d-allowed",
			content: "hi",
			cite: "detail/0/1",
		});
		const res = await app.request("/v1/documents/fetch", {
			method: "POST",
			headers: headers(token({ scope: "document", summaryId: "d-allowed" })),
			body: JSON.stringify({ documentId: "d-allowed" }),
		});
		expect(res.status).toBe(200);
		expect(((await res.json()) as { cite?: string }).cite).toBe("detail/0/1");
	});

	it("collection-scope fetch rejects a document outside the collection", async () => {
		mockUpstream({ documentId: "d1", collections: ["col-2"] });
		const res = await app.request("/v1/documents/fetch", {
			method: "POST",
			headers: headers(token({ scope: "collection", collectionId: "col-1" })),
			body: JSON.stringify({ documentId: "d1" }),
		});
		expect(res.status).toBe(403);
	});

	it("rejects search when the token has no scope (fail closed)", async () => {
		const calls = mockUpstream({ documents: [{ documentId: "leak" }] });
		const res = await app.request("/v1/documents/search", {
			method: "POST",
			headers: headers(token()),
			body: JSON.stringify({ query: "x" }),
		});
		expect(res.status).toBe(403);
		expect(calls).toHaveLength(0);
	});

	it("rejects fetch when the token has no scope (fail closed)", async () => {
		const calls = mockUpstream({ documentId: "any" });
		const res = await app.request("/v1/documents/fetch", {
			method: "POST",
			headers: headers(token()),
			body: JSON.stringify({ documentId: "any" }),
		});
		expect(res.status).toBe(403);
		expect(calls).toHaveLength(0);
	});

	it("collection-scope fetch allows a document in the collection", async () => {
		mockUpstream({ documentId: "d1", collections: ["col-1", "col-9"] });
		const res = await app.request("/v1/documents/fetch", {
			method: "POST",
			headers: headers(token({ scope: "collection", collectionId: "col-1" })),
			body: JSON.stringify({ documentId: "d1" }),
		});
		expect(res.status).toBe(200);
	});
});
