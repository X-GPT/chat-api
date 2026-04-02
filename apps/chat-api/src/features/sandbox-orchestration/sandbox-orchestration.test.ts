import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { _resetSyncState } from "./sandbox-sync-state";
import { createMockSandbox } from "./test-helpers";

type RunSandboxChatOptions =
	import("./sandbox-orchestration").RunSandboxChatOptions;

const silentLogger = {
	info: () => {},
	error: () => {},
	warn: () => {},
	debug: () => {},
	child: () => silentLogger,
};

function makeOptions(
	overrides: Partial<RunSandboxChatOptions> = {},
): RunSandboxChatOptions {
	return {
		userId: "user-1",
		query: "hello",
		scope: "general" as const,
		collectionId: null,
		summaryId: null,
		chatKey: "chat-1",
		memberCode: "user-1",
		partnerCode: "partner-1",
		memberAuthToken: "token",
		onTextDelta: () => {},
		onTextEnd: async () => {},
		logger: silentLogger as any,
		...overrides,
	};
}

describe("runSandboxChat sync check", () => {
	let runSandboxChat: typeof import("./sandbox-orchestration").runSandboxChat;
	let singletonModule: typeof import("./singleton");
	let syncModule: typeof import("./sandbox-sync-service");
	let spyGetOrCreate: ReturnType<typeof spyOn>;
	let spyIncrementalSync: ReturnType<typeof spyOn>;
	let spyEnsureInitialSync: ReturnType<typeof spyOn>;

	beforeEach(async () => {
		Bun.env.OPENAI_API_KEY = "test-openai-key";
		Bun.env.ANTHROPIC_API_KEY = "test-anthropic-key";
		Bun.env.PROTECTED_API_TOKEN = "test-token";
		_resetSyncState();
		({ runSandboxChat } = await import("./sandbox-orchestration"));
		singletonModule = await import("./singleton");
		syncModule = await import("./sandbox-sync-service");
		const sandbox = createMockSandbox();
		spyGetOrCreate = spyOn(
			singletonModule.sandboxManager,
			"getOrCreateSandbox",
		).mockResolvedValue(sandbox as any);
		spyOn(singletonModule.sandboxManager, "getDocsRoot").mockReturnValue(
			"/workspace/sandbox-prototype/docs/user-1",
		);
		spyIncrementalSync = spyOn(syncModule, "runIncrementalSync");
		spyEnsureInitialSync = spyOn(syncModule, "startInitialSyncIfNeeded");
	});

	afterEach(() => {
		spyGetOrCreate.mockRestore();
		spyIncrementalSync.mockRestore();
		spyEnsureInitialSync.mockRestore();
		mock.restore();
	});

	it("does not call getSyncStatus directly", async () => {
		spyEnsureInitialSync.mockResolvedValue({ status: "syncing" });
		const spyGetSyncStatus = spyOn(syncModule, "getSyncStatus");

		try {
			await runSandboxChat(makeOptions());
			expect(spyGetSyncStatus).not.toHaveBeenCalled();
		} finally {
			spyGetSyncStatus.mockRestore();
		}
	});

	it("returns syncing when startInitialSyncIfNeeded returns syncing", async () => {
		spyEnsureInitialSync.mockResolvedValue({ status: "syncing" });

		await expect(runSandboxChat(makeOptions())).resolves.toEqual({
			status: "syncing",
		});
		expect(spyEnsureInitialSync).toHaveBeenCalled();
		expect(spyIncrementalSync).not.toHaveBeenCalled();
	});

	it("returns syncing without running agent when sync is not complete", async () => {
		spyEnsureInitialSync.mockResolvedValue({ status: "syncing" });

		const agentModule = await import("@/features/sandbox-agent");
		const spyAgent = spyOn(agentModule, "runSandboxAgent").mockResolvedValue(
			undefined,
		);

		try {
			await expect(runSandboxChat(makeOptions())).resolves.toEqual({
				status: "syncing",
			});
			expect(spyIncrementalSync).not.toHaveBeenCalled();
			expect(spyAgent).not.toHaveBeenCalled();
		} finally {
			spyAgent.mockRestore();
		}
	});

	it("runs incremental sync and agent when startInitialSyncIfNeeded returns synced", async () => {
		spyEnsureInitialSync.mockResolvedValue({ status: "synced" });
		spyIncrementalSync.mockResolvedValue(undefined);

		const agentModule = await import("@/features/sandbox-agent");
		const spyAgent = spyOn(agentModule, "runSandboxAgent").mockResolvedValue(
			undefined,
		);

		try {
			await expect(runSandboxChat(makeOptions())).resolves.toEqual({
				status: "completed",
			});
			expect(spyIncrementalSync).toHaveBeenCalled();
			expect(spyAgent).toHaveBeenCalled();
		} finally {
			spyAgent.mockRestore();
		}
	});
});
