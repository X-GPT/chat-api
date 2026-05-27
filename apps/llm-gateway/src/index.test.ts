import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { mintLlmToken } from "@mymemo/llm-token";

const SECRET = "test-secret";
Bun.env.ANTHROPIC_API_KEY = "test-anthropic-key";
Bun.env.LLM_TOKEN_SECRET = SECRET;

// env.ts validates at module load, so import after env is set.
let app: typeof import("./index").app;
beforeAll(async () => {
	({ app } = await import("./index"));
});

const validToken = () =>
	mintLlmToken(
		{ userId: "u1", sandboxId: "sbx-1", requestId: "req-1" },
		SECRET,
	);

let fetchSpy: ReturnType<typeof spyOn> | undefined;
afterEach(() => fetchSpy?.mockRestore());

describe("llm-gateway", () => {
	it("answers GET and HEAD /health without a token", async () => {
		expect((await app.request("/health")).status).toBe(200);
		expect((await app.request("/health", { method: "HEAD" })).status).toBe(200);
	});

	it("rejects requests with no bearer token", async () => {
		const res = await app.request("/v1/messages", { method: "POST" });
		expect(res.status).toBe(401);
	});

	it("rejects an invalid bearer token", async () => {
		const res = await app.request("/v1/messages", {
			method: "POST",
			headers: { authorization: "Bearer not-a-real-token" },
		});
		expect(res.status).toBe(401);
	});

	it("injects x-api-key and forwards anthropic headers for a valid token", async () => {
		fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response('{"ok":true}', {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);

		const res = await app.request("/v1/messages", {
			method: "POST",
			headers: {
				authorization: `Bearer ${validToken()}`,
				"anthropic-version": "2023-06-01",
				"content-type": "application/json",
			},
			body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [] }),
		});

		expect(res.status).toBe(200);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.anthropic.com/v1/messages");
		const sent = new Headers(init.headers);
		expect(sent.get("x-api-key")).toBe("test-anthropic-key");
		expect(sent.get("anthropic-version")).toBe("2023-06-01");
		expect(sent.has("authorization")).toBe(false);
	});

	it("404s a non-messages path even with a valid token (no upstream call)", async () => {
		fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
			new Error("should not forward"),
		);
		const res = await app.request("/v1/files", {
			method: "POST",
			headers: { authorization: `Bearer ${validToken()}` },
			body: "{}",
		});
		expect(res.status).toBe(404);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("normalizes a trailing slash and still proxies /v1/messages", async () => {
		fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("{}", { status: 200 }),
		);
		const res = await app.request("/v1/messages/", {
			method: "POST",
			headers: {
				authorization: `Bearer ${validToken()}`,
				"content-type": "application/json",
			},
			body: "{}",
		});
		expect(res.status).toBe(200);
		const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.anthropic.com/v1/messages");
	});

	it("normalizes a double-slash path and still proxies /v1/messages", async () => {
		fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("{}", { status: 200 }),
		);
		const res = await app.request("//v1/messages", {
			method: "POST",
			headers: {
				authorization: `Bearer ${validToken()}`,
				"content-type": "application/json",
			},
			body: "{}",
		});
		expect(res.status).toBe(200);
		const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.anthropic.com/v1/messages");
	});
});
