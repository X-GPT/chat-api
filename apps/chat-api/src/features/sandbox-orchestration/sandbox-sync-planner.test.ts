import { describe, expect, it, spyOn } from "bun:test";
import type { FullSummary } from "@/features/chat/api/types";
import * as sandboxModule from "@/features/sandbox";
import {
	buildIncrementalSyncPlan,
	buildInitialSyncPlan,
	diffIncrementalSync,
} from "./sandbox-sync-planner";

const makeSummary = (overrides: Partial<FullSummary> = {}): FullSummary => ({
	id: "100",
	type: 0,
	content: "Hello world",
	parseContent: null,
	title: "Test Doc",
	summaryTitle: null,
	fileType: null,
	delFlag: 0,
	updateTime: "2026-03-27T00:00:00Z",
	checksum: `checksum-${overrides.id ?? "100"}`,
	collectionIds: [],
	...overrides,
});

describe("buildInitialSyncPlan", () => {
	it("filters deleted summaries and preserves persisted checksums", () => {
		const plan = buildInitialSyncPlan({
			userId: "user-1",
			fullSummaries: [
				makeSummary({ id: "1", checksum: "aaa", collectionIds: ["col-A"] }),
				makeSummary({ id: "2", delFlag: 1, checksum: "bbb" }),
			],
		});

		expect(plan.isEmpty).toBe(false);
		expect(plan.primaryFiles).toHaveLength(1);
		expect(plan.nextState).toEqual([
			{
				id: "1",
				checksum: "aaa",
				relativePath: "0/1.txt",
				type: 0,
				collectionIds: ["col-A"],
			},
		]);
	});

	it("stores type in nextState", () => {
		const plan = buildInitialSyncPlan({
			userId: "user-1",
			fullSummaries: [
				makeSummary({ id: "1", checksum: "aaa", type: 3 }),
			],
		});

		expect(plan.nextState[0]?.type).toBe(3);
		expect(plan.nextState[0]?.relativePath).toBe("3/1.txt");
	});
});

describe("diffIncrementalSync", () => {
	it("detects content, collection, and deleted changes", () => {
		const diff = diffIncrementalSync(
			[
				{ id: "1", checksum: "a2", type: 0, collectionIds: [] },
				{ id: "2", checksum: "b1", type: 0, collectionIds: ["col-B"] },
			],
			[
				{ id: "1", checksum: "a1", relativePath: "0/1.txt", type: 0, collectionIds: [] },
				{ id: "2", checksum: "b1", relativePath: "0/2.txt", type: 0, collectionIds: ["col-A"] },
				{ id: "3", checksum: "c1", relativePath: "0/3.txt", type: 0, collectionIds: [] },
			],
		);

		expect(diff.contentChangedIds).toEqual(["1"]);
		expect(diff.collectionChangedIds).toEqual(["2"]);
		expect(diff.deletedEntries.map((entry) => entry.id)).toEqual(["3"]);
	});

	it("detects collection removal when manifest omits collectionIds", () => {
		const diff = diffIncrementalSync(
			[{ id: "1", checksum: "aaa", type: 0 }],
			[
				{
					id: "1",
					checksum: "aaa",
					relativePath: "0/1.txt",
					type: 0,
					collectionIds: ["col-A"],
				},
			],
		);

		expect(diff.collectionChangedIds).toEqual(["1"]);
	});

	it("detects type change as content change", () => {
		const diff = diffIncrementalSync(
			[{ id: "1", checksum: "aaa", type: 3, collectionIds: [] }],
			[
				{
					id: "1",
					checksum: "aaa",
					relativePath: "0/1.txt",
					type: 0,
					collectionIds: [],
				},
			],
		);

		expect(diff.contentChangedIds).toEqual(["1"]);
		expect(diff.collectionChangedIds).toEqual([]);
	});

	it("does not double-count type change in collectionChangedIds", () => {
		const diff = diffIncrementalSync(
			[{ id: "1", checksum: "aaa", type: 3, collectionIds: ["col-B"] }],
			[
				{
					id: "1",
					checksum: "aaa",
					relativePath: "0/1.txt",
					type: 0,
					collectionIds: ["col-A"],
				},
			],
		);

		expect(diff.contentChangedIds).toEqual(["1"]);
		expect(diff.collectionChangedIds).toEqual([]);
	});
});

describe("buildIncrementalSyncPlan", () => {
	it("updates collection-only changes without rewriting content", () => {
		const manifest = [{ id: "1", checksum: "aaa", type: 0, collectionIds: ["col-B"] }];
		const storedState = [
			{
				id: "1",
				checksum: "aaa",
				relativePath: "0/1.txt",
				type: 0,
				collectionIds: ["col-A"],
			},
		];
		const plan = buildIncrementalSyncPlan({
			userId: "user-1",
			manifest,
			storedState,
			changedSummaries: [],
			diff: diffIncrementalSync(manifest, storedState),
		});

		expect(plan.writeFiles).toHaveLength(0);
		expect(plan.createCollectionLinks).toEqual([
			{
				relativePath: "collections/col-B/0/1.txt",
				target: "../../../0/1.txt",
			},
		]);
		expect(plan.nextState).toEqual([
			{
				id: "1",
				checksum: "aaa",
				relativePath: "0/1.txt",
				type: 0,
				collectionIds: ["col-B"],
			},
		]);
	});

	it("emits old path removal when materialized path changes", () => {
		const spyMaterializeSummary = spyOn(sandboxModule, "materializeSummary")
			.mockReturnValueOnce({
				summaryId: "1",
				type: 2,
				path: "/workspace/sandbox-prototype/docs/user-1/2/1.txt",
				relativePath: "2/1.txt",
				content: "x",
				checksum: "bbb",
			});

		try {
			const manifest = [{ id: "1", checksum: "bbb", type: 2, collectionIds: [] }];
			const storedState = [
				{
					id: "1",
					checksum: "aaa",
					relativePath: "0/1.txt",
					type: 0,
					collectionIds: [],
				},
			];
			const plan = buildIncrementalSyncPlan({
				userId: "user-1",
				manifest,
				storedState,
				changedSummaries: [makeSummary({ id: "1", checksum: "bbb", type: 2 })],
				diff: diffIncrementalSync(manifest, storedState),
			});

			expect(plan.removeFiles).toContain(
				"/workspace/sandbox-prototype/docs/user-1/0/1.txt",
			);
		} finally {
			spyMaterializeSummary.mockRestore();
		}
	});
});
