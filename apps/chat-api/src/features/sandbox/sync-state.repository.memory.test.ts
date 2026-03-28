import { beforeEach, describe, expect, it } from "bun:test";
import { InMemorySyncStateRepository } from "./sync-state.repository.memory";
import type { SyncStateRecord } from "./sync-state.types";

const makeRecord = (
	overrides: Partial<SyncStateRecord> = {},
): SyncStateRecord => ({
	userId: "user-1",
	sandboxId: "sbx-1",
	summaryId: "sum-1",
	type: 0,
	expectedPath: "/workspace/docs/user-1/0/sum-1.txt",
	contentChecksum: "abc123",
	sourceUpdatedAt: "2026-03-27T00:00:00Z",
	lastSyncedAt: null,
	syncStatus: "synced",
	...overrides,
});

describe("InMemorySyncStateRepository", () => {
	let repo: InMemorySyncStateRepository;

	beforeEach(() => {
		repo = new InMemorySyncStateRepository();
	});

	describe("upsert / findBySummaryId", () => {
		it("inserts a new record", async () => {
			const record = makeRecord();
			await repo.upsert(record);
			const found = await repo.findBySummaryId("user-1", "sum-1");
			expect(found).toEqual(record);
		});

		it("overwrites an existing record", async () => {
			await repo.upsert(makeRecord({ contentChecksum: "old" }));
			await repo.upsert(makeRecord({ contentChecksum: "new" }));
			const found = await repo.findBySummaryId("user-1", "sum-1");
			expect(found?.contentChecksum).toBe("new");
		});

		it("returns null for non-existent record", async () => {
			const found = await repo.findBySummaryId("user-1", "nope");
			expect(found).toBeNull();
		});
	});

	describe("delete", () => {
		it("removes a record", async () => {
			await repo.upsert(makeRecord());
			await repo.delete("user-1", "sum-1");
			const found = await repo.findBySummaryId("user-1", "sum-1");
			expect(found).toBeNull();
		});

		it("does nothing for non-existent record", async () => {
			await repo.delete("user-1", "nope");
			// no throw
		});
	});

	describe("bulkUpsert", () => {
		it("inserts multiple records", async () => {
			await repo.bulkUpsert([
				makeRecord({ summaryId: "a" }),
				makeRecord({ summaryId: "b" }),
				makeRecord({ summaryId: "c" }),
			]);
			const results = await repo.findByUserId("user-1");
			expect(results).toHaveLength(3);
		});
	});

	describe("bulkDelete", () => {
		it("deletes multiple records", async () => {
			await repo.bulkUpsert([
				makeRecord({ summaryId: "a" }),
				makeRecord({ summaryId: "b" }),
				makeRecord({ summaryId: "c" }),
			]);
			await repo.bulkDelete("user-1", ["a", "c"]);
			const results = await repo.findByUserId("user-1");
			expect(results).toHaveLength(1);
			expect(results[0]?.summaryId).toBe("b");
		});
	});

	describe("deleteAllForUser", () => {
		it("deletes all records for a user", async () => {
			await repo.bulkUpsert([
				makeRecord({ userId: "user-1", summaryId: "a" }),
				makeRecord({ userId: "user-1", summaryId: "b" }),
				makeRecord({ userId: "user-2", summaryId: "c" }),
			]);
			await repo.deleteAllForUser("user-1");
			expect(await repo.findByUserId("user-1")).toHaveLength(0);
			expect(await repo.findByUserId("user-2")).toHaveLength(1);
		});
	});

	describe("findByUserAndSandbox", () => {
		it("filters by both userId and sandboxId", async () => {
			await repo.bulkUpsert([
				makeRecord({ sandboxId: "sbx-1", summaryId: "a" }),
				makeRecord({ sandboxId: "sbx-2", summaryId: "b" }),
				makeRecord({ sandboxId: "sbx-1", summaryId: "c" }),
			]);
			const results = await repo.findByUserAndSandbox("user-1", "sbx-1");
			expect(results).toHaveLength(2);
			expect(results.map((r) => r?.summaryId).sort()).toEqual(["a", "c"]);
		});
	});

	describe("findByUserId", () => {
		it("returns all records for a user", async () => {
			await repo.bulkUpsert([
				makeRecord({ userId: "user-1", summaryId: "a" }),
				makeRecord({ userId: "user-1", summaryId: "b" }),
				makeRecord({ userId: "user-2", summaryId: "c" }),
			]);
			const results = await repo.findByUserId("user-1");
			expect(results).toHaveLength(2);
		});

		it("returns empty array for unknown user", async () => {
			const results = await repo.findByUserId("unknown");
			expect(results).toHaveLength(0);
		});
	});

	describe("findByStatus", () => {
		it("filters by syncStatus", async () => {
			await repo.bulkUpsert([
				makeRecord({ summaryId: "a", syncStatus: "synced" }),
				makeRecord({ summaryId: "b", syncStatus: "error" }),
				makeRecord({ summaryId: "c", syncStatus: "synced" }),
			]);
			const synced = await repo.findByStatus("user-1", "synced");
			expect(synced).toHaveLength(2);

			const errors = await repo.findByStatus("user-1", "error");
			expect(errors).toHaveLength(1);
			expect(errors[0]?.summaryId).toBe("b");
		});
	});

	describe("updateStatus", () => {
		it("updates syncStatus on an existing record", async () => {
			await repo.upsert(makeRecord({ syncStatus: "synced" }));
			await repo.updateStatus("user-1", "sum-1", "error");
			const found = await repo.findBySummaryId("user-1", "sum-1");
			expect(found?.syncStatus).toBe("error");
		});

		it("updates lastSyncedAt when timestamp provided", async () => {
			await repo.upsert(makeRecord({ lastSyncedAt: null }));
			await repo.updateStatus(
				"user-1",
				"sum-1",
				"synced",
				"2026-03-27T12:00:00Z",
			);
			const found = await repo.findBySummaryId("user-1", "sum-1");
			expect(found?.lastSyncedAt).toBe("2026-03-27T12:00:00Z");
		});

		it("does nothing for non-existent record", async () => {
			await repo.updateStatus("user-1", "nope", "error");
			// no throw
		});
	});
});
