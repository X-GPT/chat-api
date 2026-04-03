import { describe, expect, it } from "bun:test";
import { createMockSandbox } from "./test-helpers";
import {
	clearSyncErrorMessage,
	isInitialSyncComplete,
	readStoredSyncState,
	readSyncErrorMessage,
	writeStoredSyncState,
	writeSyncCompleteMarker,
	writeSyncErrorMessage,
} from "./sandbox-sync-state";

describe("sandbox-sync-state", () => {
	it("reads invalid stored state as empty", async () => {
		const sandbox = createMockSandbox();
		sandbox.filesContent.set("/docs/.sync-state.json", "not-json");

		await expect(readStoredSyncState(sandbox as any, "/docs")).resolves.toEqual(
			[],
		);
	});

	it("writes and reads error markers best-effort", async () => {
		const sandbox = createMockSandbox();

		await writeSyncErrorMessage(sandbox as any, "/docs", "boom");
		expect(await readSyncErrorMessage(sandbox as any, "/docs")).toBe("boom");

		await clearSyncErrorMessage(sandbox as any, "/docs");
		expect(sandbox.commandsRun.at(-1)).toContain(".sync-error");
	});

	it("detects sync complete marker on disk", async () => {
		const sandbox = createMockSandbox();
		await writeSyncCompleteMarker(sandbox as any, "/docs");
		expect(await isInitialSyncComplete(sandbox as any, "/docs")).toBe(true);
	});

	it("round-trips stored state", async () => {
		const sandbox = createMockSandbox();
		const state = [{ id: "1", checksum: "aaa", relativePath: "0/1.txt" }];
		await writeStoredSyncState(sandbox as any, "/docs", state);
		expect(await readStoredSyncState(sandbox as any, "/docs")).toEqual(state);
	});
});
