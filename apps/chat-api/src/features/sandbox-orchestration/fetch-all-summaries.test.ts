import { afterEach, describe, expect, it, spyOn } from "bun:test";

Bun.env.OPENAI_API_KEY = Bun.env.OPENAI_API_KEY ?? "test-openai-key";
Bun.env.ANTHROPIC_API_KEY = Bun.env.ANTHROPIC_API_KEY ?? "test-anthropic-key";
Bun.env.PROTECTED_API_TOKEN = Bun.env.PROTECTED_API_TOKEN ?? "test-token";

import { fetchAllFullSummaries } from "./fetch-all-summaries";

const silentLogger = {
	info(_obj: Record<string, unknown>) {},
	error(_obj: Record<string, unknown>) {},
};

const makeSummary = (id: string) => ({
	id,
	type: 0,
	content: "Hello world",
	parseContent: null,
	title: "Test Doc",
	summaryTitle: null,
	fileType: null,
	delFlag: 0,
	updateTime: "2026-03-27T00:00:00Z",
	checksum: `checksum-${id}`,
	collectionIds: [],
});

function makePaginatedResponse(
	list: ReturnType<typeof makeSummary>[],
	totalPages: number,
	page: number,
) {
	return new Response(
		JSON.stringify({
			list,
			total: list.length,
			totalPages,
			page,
			pageSize: 100,
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

describe("fetchAllFullSummaries", () => {
	afterEach(() => {
		(globalThis.fetch as any)?.mockRestore?.();
	});

	it("returns all items from a single page", async () => {
		const items = [makeSummary("1"), makeSummary("2")];
		spyOn(globalThis, "fetch").mockResolvedValueOnce(
			makePaginatedResponse(items, 1, 1),
		);

		const result = await fetchAllFullSummaries(
			"member-1",
			"partner-1",
			{},
			silentLogger as any,
		);

		expect(result).toHaveLength(2);
		expect(result[0]?.id).toBe("1");
		expect(result[0]?.checksum).toBe("checksum-1");
	});

	it("accumulates results across multiple pages", async () => {
		const spy = spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(makePaginatedResponse([makeSummary("1")], 3, 1))
			.mockResolvedValueOnce(makePaginatedResponse([makeSummary("2")], 3, 2))
			.mockResolvedValueOnce(makePaginatedResponse([makeSummary("3")], 3, 3));

		const result = await fetchAllFullSummaries(
			"member-1",
			"partner-1",
			{},
			silentLogger as any,
		);

		expect(result).toHaveLength(3);
		expect(spy).toHaveBeenCalledTimes(3);
	});

	it("returns empty array when first page has no items", async () => {
		spyOn(globalThis, "fetch").mockResolvedValueOnce(
			makePaginatedResponse([], 0, 1),
		);

		const result = await fetchAllFullSummaries(
			"member-1",
			"partner-1",
			{},
			silentLogger as any,
		);

		expect(result).toHaveLength(0);
	});
});
