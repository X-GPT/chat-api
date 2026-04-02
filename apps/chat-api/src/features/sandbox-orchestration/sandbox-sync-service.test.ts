import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as manifestModule from "@/features/chat/api/manifest";
import * as summariesModule from "@/features/chat/api/summaries";
import * as fetchAllModule from "./fetch-all-summaries";
import {
	startInitialSyncIfNeeded,
	getSyncStatus,
	runIncrementalSync,
} from "./sandbox-sync-service";
import { _resetSyncState } from "./sandbox-sync-state";
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
	beforeEach(() => {
		_resetSyncState();
	});

	afterEach(() => {
		_resetSyncState();
	});

	it("returns idle when no state exists", async () => {
		const sandbox = createMockSandbox();
		await expect(
			getSyncStatus({
				userId: "user-1",
				sandbox: sandbox as any,
				docsRoot: "/workspace/sandbox-prototype/docs/user-1",
			}),
		).resolves.toEqual({ status: "idle" });
	});

	it("starts background initial sync and marks synced on completion", async () => {
		const sandbox = createMockSandbox();
		const spyFetchAll = spyOn(fetchAllModule, "fetchAllFullSummaries").mockResolvedValue(
			[],
		);

		try {
			expect(
				await startInitialSyncIfNeeded({
					userId: "user-1",
					sandbox: sandbox as any,
					options: syncOptions,
					logger: silentLogger as any,
				}),
			).toEqual({ status: "syncing" });

			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(
				await getSyncStatus({
					userId: "user-1",
					sandbox: sandbox as any,
					docsRoot: "/workspace/sandbox-prototype/docs/user-1",
				}),
			).toEqual({ status: "synced" });
		} finally {
			spyFetchAll.mockRestore();
		}
	});

	it("returns error status when initial sync fails", async () => {
		const sandbox = createMockSandbox();
		const spyFetchAll = spyOn(fetchAllModule, "fetchAllFullSummaries").mockRejectedValue(
			new Error("boom"),
		);

		try {
			await startInitialSyncIfNeeded({
				userId: "user-1",
				sandbox: sandbox as any,
				options: syncOptions,
				logger: silentLogger as any,
			});
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(
				await getSyncStatus({
					userId: "user-1",
					sandbox: sandbox as any,
					docsRoot: "/workspace/sandbox-prototype/docs/user-1",
				}),
			).toEqual({ status: "error", message: "boom" });
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
