import { describe, expect, it, spyOn } from "bun:test";
import * as manifestModule from "@/features/chat/api/manifest";
import * as summariesModule from "@/features/chat/api/summaries";
import * as fetchAllModule from "./fetch-all-summaries";
import {
	ensureInitialSync,
	getSyncStatus,
	runIncrementalSync,
} from "./sandbox-sync-service";
import { createMockSandbox } from "./test-helpers";

const silentLogger = {
	info(_obj: Record<string, unknown>) {},
	error(_obj: Record<string, unknown>) {},
};

const syncOptions = {
	memberCode: "user-1",
	partnerCode: "partner-1",
	memberAuthToken: "token-123",
};

describe("sandbox-sync-service", () => {
	it("returns idle when no state exists", async () => {
		const sandbox = createMockSandbox();
		await expect(
			getSyncStatus({
				sandbox: sandbox as any,
				docsRoot: "/workspace/sandbox-prototype/docs/user-1",
			}),
		).resolves.toEqual({ status: "idle" });
	});

	it("runs initial sync inline and returns", async () => {
		const sandbox = createMockSandbox();
		const spyFetchAll = spyOn(fetchAllModule, "fetchAllFullSummaries").mockResolvedValue(
			[],
		);

		try {
			await ensureInitialSync({
				userId: "user-1",
				sandbox: sandbox as any,
				options: syncOptions,
				logger: silentLogger as any,
			});

			// .sync-complete marker should be written by applyInitialSyncPlan
			await expect(
				getSyncStatus({
					sandbox: sandbox as any,
					docsRoot: "/workspace/sandbox-prototype/docs/user-1",
				}),
			).resolves.toEqual({ status: "synced" });
		} finally {
			spyFetchAll.mockRestore();
		}
	});

	it("throws and writes .sync-error on failure", async () => {
		const sandbox = createMockSandbox();
		const spyFetchAll = spyOn(fetchAllModule, "fetchAllFullSummaries").mockRejectedValue(
			new Error("boom"),
		);

		try {
			await expect(
				ensureInitialSync({
					userId: "user-1",
					sandbox: sandbox as any,
					options: syncOptions,
					logger: silentLogger as any,
				}),
			).rejects.toThrow("boom");

			await expect(
				getSyncStatus({
					sandbox: sandbox as any,
					docsRoot: "/workspace/sandbox-prototype/docs/user-1",
				}),
			).resolves.toEqual({ status: "error", message: "boom" });
		} finally {
			spyFetchAll.mockRestore();
		}
	});

	it("skips initial sync when already complete", async () => {
		const sandbox = createMockSandbox();
		// Write .sync-complete marker
		sandbox.filesContent.set(
			"/workspace/sandbox-prototype/docs/user-1/.sync-complete",
			new Date().toISOString(),
		);
		const spyFetchAll = spyOn(fetchAllModule, "fetchAllFullSummaries");

		try {
			await ensureInitialSync({
				userId: "user-1",
				sandbox: sandbox as any,
				options: syncOptions,
				logger: silentLogger as any,
			});

			expect(spyFetchAll).not.toHaveBeenCalled();
		} finally {
			spyFetchAll.mockRestore();
		}
	});

	it("skips incremental sync when manifest matches stored state", async () => {
		const sandbox = createMockSandbox();
		sandbox.filesContent.set(
			"/workspace/sandbox-prototype/docs/user-1/.sync-state.json",
			JSON.stringify([{ id: "1", checksum: "aaa", relativePath: "0/1.txt" }]),
		);

		const spyManifest = spyOn(
			manifestModule,
			"fetchSummariesManifest",
		).mockResolvedValue([{ id: "1", checksum: "aaa", collectionIds: [] }]);
		const spySummaries = spyOn(
			summariesModule,
			"fetchProtectedSummaries",
		).mockResolvedValue([]);

		try {
			await runIncrementalSync({
				userId: "user-1",
				sandbox: sandbox as any,
				options: syncOptions,
				logger: silentLogger as any,
			});
			expect(spySummaries).not.toHaveBeenCalled();
		} finally {
			spyManifest.mockRestore();
			spySummaries.mockRestore();
		}
	});
});
