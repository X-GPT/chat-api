import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
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

describe("runSandboxChat", () => {
	let runSandboxChat: typeof import("./sandbox-orchestration").runSandboxChat;
	let singletonModule: typeof import("./singleton");
	let syncModule: typeof import("./sandbox-sync-service");
	let spyGetOrCreate: ReturnType<typeof spyOn>;
	let spyIncrementalSync: ReturnType<typeof spyOn>;
	let spyEnsureSync: ReturnType<typeof spyOn>;

	beforeEach(async () => {
		Bun.env.OPENAI_API_KEY = "test-openai-key";
		Bun.env.ANTHROPIC_API_KEY = "test-anthropic-key";
		Bun.env.PROTECTED_API_TOKEN = "test-token";
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
		spyEnsureSync = spyOn(syncModule, "ensureInitialSync");
	});

	afterEach(() => {
		spyGetOrCreate.mockRestore();
		spyIncrementalSync.mockRestore();
		spyEnsureSync.mockRestore();
		mock.restore();
	});

	it("runs initial sync, incremental sync, and agent", async () => {
		spyEnsureSync.mockResolvedValue(undefined);
		spyIncrementalSync.mockResolvedValue(undefined);

		const agentModule = await import("@/features/sandbox-agent");
		const spyAgent = spyOn(agentModule, "runSandboxAgent").mockResolvedValue(
			undefined,
		);

		try {
			await expect(runSandboxChat(makeOptions())).resolves.toEqual({
				status: "completed",
			});
			expect(spyEnsureSync).toHaveBeenCalled();
			expect(spyIncrementalSync).toHaveBeenCalled();
			expect(spyAgent).toHaveBeenCalled();
		} finally {
			spyAgent.mockRestore();
		}
	});

	it("propagates initial sync failure without running agent", async () => {
		spyEnsureSync.mockRejectedValue(new Error("sync failed"));

		const agentModule = await import("@/features/sandbox-agent");
		const spyAgent = spyOn(agentModule, "runSandboxAgent").mockResolvedValue(
			undefined,
		);

		try {
			await expect(runSandboxChat(makeOptions())).rejects.toThrow(
				"sync failed",
			);
			expect(spyIncrementalSync).not.toHaveBeenCalled();
			expect(spyAgent).not.toHaveBeenCalled();
		} finally {
			spyAgent.mockRestore();
		}
	});
});
