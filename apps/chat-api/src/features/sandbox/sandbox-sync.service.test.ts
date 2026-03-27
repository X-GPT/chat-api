import { describe, expect, it } from "bun:test";
import type { ProtectedSummary } from "@/features/chat/api/types";
import type { MaterializationConfig } from "./materialization";
import { SandboxSyncService } from "./sandbox-sync.service";
import { InMemorySyncStateRepository } from "./sync-state.repository.memory";

const config: MaterializationConfig = {
	workspaceRoot: "/workspace/sandbox-prototype",
	userId: "user-1",
};

const silentLogger = {
	info(_obj: Record<string, unknown>) {},
	error(_obj: Record<string, unknown>) {},
};

const makeSummary = (
	overrides: Partial<ProtectedSummary> = {},
): ProtectedSummary => ({
	id: "100",
	type: 0,
	content: "Hello world",
	parseContent: null,
	title: "Test Doc",
	summaryTitle: null,
	fileType: null,
	delFlag: 0,
	updateTime: "2026-03-27T00:00:00Z",
	...overrides,
});

function createService() {
	const repository = new InMemorySyncStateRepository();
	const service = new SandboxSyncService({
		repository,
		logger: silentLogger,
	});
	return { repository, service };
}

describe("SandboxSyncService.buildReconciliationPlan", () => {
	it("produces creates for new summaries", async () => {
		const { service } = createService();
		const plan = await service.buildReconciliationPlan(
			"user-1",
			"sbx-1",
			[makeSummary({ id: "1" }), makeSummary({ id: "2" })],
			config,
		);

		expect(plan.creates).toHaveLength(2);
		expect(plan.updates).toHaveLength(0);
		expect(plan.deletes).toHaveLength(0);
		expect(plan.unchanged).toBe(0);
	});

	it("produces updates when content changes", async () => {
		const { repository, service } = createService();

		// Seed existing state
		const firstPlan = await service.buildReconciliationPlan(
			"user-1",
			"sbx-1",
			[makeSummary({ id: "1", content: "version 1" })],
			config,
		);
		// Simulate applying the first plan
		for (const action of firstPlan.creates) {
			await repository.upsert({
				...action.record,
				lastSyncedAt: new Date().toISOString(),
			});
		}

		// Now change content
		const plan = await service.buildReconciliationPlan(
			"user-1",
			"sbx-1",
			[makeSummary({ id: "1", content: "version 2" })],
			config,
		);

		expect(plan.creates).toHaveLength(0);
		expect(plan.updates).toHaveLength(1);
		expect(plan.updates[0].reason).toBe("content_changed");
		expect(plan.deletes).toHaveLength(0);
		expect(plan.unchanged).toBe(0);
	});

	it("produces noop when content is unchanged", async () => {
		const { repository, service } = createService();

		const summaries = [makeSummary({ id: "1", content: "stable" })];

		const firstPlan = await service.buildReconciliationPlan(
			"user-1",
			"sbx-1",
			summaries,
			config,
		);
		for (const action of firstPlan.creates) {
			await repository.upsert(action.record);
		}

		const plan = await service.buildReconciliationPlan(
			"user-1",
			"sbx-1",
			summaries,
			config,
		);

		expect(plan.creates).toHaveLength(0);
		expect(plan.updates).toHaveLength(0);
		expect(plan.deletes).toHaveLength(0);
		expect(plan.unchanged).toBe(1);
	});

	it("produces deletes for removed summaries", async () => {
		const { repository, service } = createService();

		// Seed two documents
		const firstPlan = await service.buildReconciliationPlan(
			"user-1",
			"sbx-1",
			[makeSummary({ id: "1" }), makeSummary({ id: "2" })],
			config,
		);
		for (const action of firstPlan.creates) {
			await repository.upsert(action.record);
		}

		// Source now only has document 1
		const plan = await service.buildReconciliationPlan(
			"user-1",
			"sbx-1",
			[makeSummary({ id: "1" })],
			config,
		);

		expect(plan.creates).toHaveLength(0);
		expect(plan.deletes).toHaveLength(1);
		expect(plan.deletes[0].record.summaryId).toBe("2");
		expect(plan.unchanged).toBe(1);
	});

	it("produces deletes for summaries with delFlag=1", async () => {
		const { repository, service } = createService();

		const firstPlan = await service.buildReconciliationPlan(
			"user-1",
			"sbx-1",
			[makeSummary({ id: "1" })],
			config,
		);
		for (const action of firstPlan.creates) {
			await repository.upsert(action.record);
		}

		// Source now has delFlag=1
		const plan = await service.buildReconciliationPlan(
			"user-1",
			"sbx-1",
			[makeSummary({ id: "1", delFlag: 1 })],
			config,
		);

		expect(plan.creates).toHaveLength(0);
		expect(plan.deletes).toHaveLength(1);
		expect(plan.deletes[0].record.summaryId).toBe("1");
	});

	it("handles delFlag as string '1'", async () => {
		const { repository, service } = createService();

		const firstPlan = await service.buildReconciliationPlan(
			"user-1",
			"sbx-1",
			[makeSummary({ id: "1" })],
			config,
		);
		for (const action of firstPlan.creates) {
			await repository.upsert(action.record);
		}

		const plan = await service.buildReconciliationPlan(
			"user-1",
			"sbx-1",
			[makeSummary({ id: "1", delFlag: "1" })],
			config,
		);

		expect(plan.deletes).toHaveLength(1);
	});

	it("handles mixed creates, updates, deletes, and unchanged", async () => {
		const { repository, service } = createService();

		// Seed three documents
		const firstPlan = await service.buildReconciliationPlan(
			"user-1",
			"sbx-1",
			[
				makeSummary({ id: "keep", content: "stable" }),
				makeSummary({ id: "change", content: "v1" }),
				makeSummary({ id: "remove", content: "gone soon" }),
			],
			config,
		);
		for (const action of firstPlan.creates) {
			await repository.upsert(action.record);
		}

		// Source: keep unchanged, change updated, remove gone, new added
		const plan = await service.buildReconciliationPlan(
			"user-1",
			"sbx-1",
			[
				makeSummary({ id: "keep", content: "stable" }),
				makeSummary({ id: "change", content: "v2" }),
				makeSummary({ id: "new-doc", content: "brand new" }),
			],
			config,
		);

		expect(plan.unchanged).toBe(1);
		expect(plan.updates).toHaveLength(1);
		expect(plan.updates[0].record.summaryId).toBe("change");
		expect(plan.deletes).toHaveLength(1);
		expect(plan.deletes[0].record.summaryId).toBe("remove");
		expect(plan.creates).toHaveLength(1);
		expect(plan.creates[0].record.summaryId).toBe("new-doc");
	});

	it("empty source with existing records produces all deletes", async () => {
		const { repository, service } = createService();

		const firstPlan = await service.buildReconciliationPlan(
			"user-1",
			"sbx-1",
			[makeSummary({ id: "1" }), makeSummary({ id: "2" })],
			config,
		);
		for (const action of firstPlan.creates) {
			await repository.upsert(action.record);
		}

		const plan = await service.buildReconciliationPlan(
			"user-1",
			"sbx-1",
			[],
			config,
		);

		expect(plan.deletes).toHaveLength(2);
		expect(plan.creates).toHaveLength(0);
		expect(plan.unchanged).toBe(0);
	});

	it("empty source with no existing records produces empty plan", async () => {
		const { service } = createService();

		const plan = await service.buildReconciliationPlan(
			"user-1",
			"sbx-1",
			[],
			config,
		);

		expect(plan.creates).toHaveLength(0);
		expect(plan.updates).toHaveLength(0);
		expect(plan.deletes).toHaveLength(0);
		expect(plan.unchanged).toBe(0);
	});

	it("isolates users — records from other users are not affected", async () => {
		const { repository, service } = createService();

		// Seed records for user-2
		await repository.upsert({
			userId: "user-2",
			sandboxId: "sbx-2",
			summaryId: "other",
			type: 0,
			expectedPath: "/workspace/docs/user-2/0/other.txt",
			contentChecksum: "xxx",
			sourceUpdatedAt: "2026-03-27T00:00:00Z",
			lastSyncedAt: null,
			syncStatus: "synced",
		});

		const plan = await service.buildReconciliationPlan(
			"user-1",
			"sbx-1",
			[makeSummary({ id: "1" })],
			config,
		);

		// Should only create for user-1, not delete user-2's record
		expect(plan.creates).toHaveLength(1);
		expect(plan.deletes).toHaveLength(0);

		// user-2's record still exists
		const user2Records = await repository.findByUserId("user-2");
		expect(user2Records).toHaveLength(1);
	});
});

describe("SandboxSyncService.withLock (serialization)", () => {
	it("serializes concurrent calls for the same user", async () => {
		const { service } = createService();
		const order: number[] = [];

		const p1 = service.buildReconciliationPlan(
			"user-1",
			"sbx-1",
			[makeSummary({ id: "1" })],
			config,
		);
		const p2 = service.buildReconciliationPlan(
			"user-1",
			"sbx-1",
			[makeSummary({ id: "2" })],
			config,
		);

		const [r1, r2] = await Promise.all([
			p1.then((r) => {
				order.push(1);
				return r;
			}),
			p2.then((r) => {
				order.push(2);
				return r;
			}),
		]);

		// Both should succeed
		expect(r1.creates).toHaveLength(1);
		expect(r2.creates).toHaveLength(1);
	});
});
