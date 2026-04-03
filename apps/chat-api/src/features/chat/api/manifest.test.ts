import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { fetchSummariesManifest } from "./manifest";

const silentLogger = {
	info(_obj: Record<string, unknown>) {},
	error(_obj: Record<string, unknown>) {},
};

function mockFetchResponse(body: unknown, status = 200) {
	return spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		}),
	);
}

describe("fetchSummariesManifest", () => {
	afterEach(() => {
		// Restore original fetch after each test
		(globalThis.fetch as any)?.mockRestore?.();
	});

	it("returns manifest entries on successful response", async () => {
		const entries = [
			{ id: "1", checksum: "abc123", type: 0 },
			{ id: "2", checksum: "def456", type: 3 },
		];
		mockFetchResponse({ code: 200, msg: "ok", data: entries });

		const result = await fetchSummariesManifest(
			"member-1",
			"partner-1",
			{},
			silentLogger as any,
		);

		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({ id: "1", checksum: "abc123", type: 0 });
		expect(result[1]).toEqual({ id: "2", checksum: "def456", type: 3 });
	});

	it("throws when data field is missing", async () => {
		mockFetchResponse({ code: 200, msg: "ok" });

		await expect(
			fetchSummariesManifest("member-1", "partner-1", {}, silentLogger as any),
		).rejects.toThrow("Manifest response missing data field");
	});

	it("throws on non-200 HTTP status", async () => {
		spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("Not Found", { status: 404 }),
		);

		await expect(
			fetchSummariesManifest("member-1", "partner-1", {}, silentLogger as any),
		).rejects.toThrow("Failed to fetch manifest: 404");
	});

	it("throws on invalid response schema", async () => {
		mockFetchResponse({ invalid: true });

		await expect(
			fetchSummariesManifest("member-1", "partner-1", {}, silentLogger as any),
		).rejects.toThrow("Invalid manifest response structure");
	});

	it("throws on business error code", async () => {
		mockFetchResponse({ code: 500, msg: "Internal error", data: [] });

		await expect(
			fetchSummariesManifest("member-1", "partner-1", {}, silentLogger as any),
		).rejects.toThrow("Failed to fetch manifest: Internal error");
	});
});
