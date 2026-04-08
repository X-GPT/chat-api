import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import { createMockSandbox } from "./test-helpers";

type RunSandboxChatOptions =
	import("./sandbox-orchestration").RunSandboxChatOptions;

import type { ChatLogger } from "@/features/chat/chat.logger";

const silentLogger = {
	info: () => {},
	error: () => {},
	warn: () => {},
	debug: () => {},
	child: () => silentLogger,
} as unknown as ChatLogger;

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
		logger: silentLogger,
		...overrides,
	};
}

describe("runSandboxChat", () => {
	let runSandboxChat: typeof import("./sandbox-orchestration").runSandboxChat;
	let singletonModule: typeof import("./singleton");
	let proxyModule: typeof import("./sandbox-proxy");
	let runtimeModule: typeof import("@/db/user-runtime");
	let spyGetOrCreate: ReturnType<typeof spyOn>;
	let spyEnsureDaemon: ReturnType<typeof spyOn>;
	let spyForwardTurn: ReturnType<typeof spyOn>;
	let spyGetTurnContext: ReturnType<typeof spyOn>;
	let spyUpsertSessionId: ReturnType<typeof spyOn>;

	beforeEach(async () => {
		Bun.env.OPENAI_API_KEY = "test-openai-key";
		Bun.env.ANTHROPIC_API_KEY = "test-anthropic-key";
		Bun.env.PROTECTED_API_TOKEN = "test-token";
		({ runSandboxChat } = await import("./sandbox-orchestration"));
		singletonModule = await import("./singleton");
		proxyModule = await import("./sandbox-proxy");
		runtimeModule = await import("@/db/user-runtime");

		const sandbox = createMockSandbox();
		spyGetOrCreate = spyOn(
			singletonModule.sandboxManager,
			"getOrCreateSandbox",
		).mockResolvedValue(sandbox as unknown as import("e2b").Sandbox);
		spyEnsureDaemon = spyOn(
			singletonModule.sandboxManager,
			"ensureSandboxDaemon",
		).mockResolvedValue("http://daemon:8080");

		spyGetTurnContext = spyOn(
			runtimeModule,
			"getTurnContext",
		).mockResolvedValue({ state_version: 5, agent_session_id: "prev-session" });
		spyUpsertSessionId = spyOn(
			runtimeModule,
			"upsertSessionId",
		).mockResolvedValue(undefined);
	});

	afterEach(() => {
		spyGetOrCreate.mockRestore();
		spyEnsureDaemon.mockRestore();
		spyForwardTurn?.mockRestore();
		spyGetTurnContext.mockRestore();
		spyUpsertSessionId.mockRestore();
		mock.restore();
	});

	it("forwards turn to daemon and returns completed", async () => {
		spyForwardTurn = spyOn(
			proxyModule,
			"forwardChatTurnToSandbox",
		).mockResolvedValue(undefined);

		const result = await runSandboxChat(makeOptions());

		expect(result).toEqual({ status: "completed" });
		expect(spyGetOrCreate).toHaveBeenCalled();
		expect(spyEnsureDaemon).toHaveBeenCalled();
		expect(spyGetTurnContext).toHaveBeenCalled();
		expect(spyForwardTurn).toHaveBeenCalled();
	});

	it("passes state_version and agent_session_id from runtime", async () => {
		spyForwardTurn = spyOn(
			proxyModule,
			"forwardChatTurnToSandbox",
		).mockImplementation(async (opts) => {
			expect(opts.turnRequest.required_version).toBe(5);
			expect(opts.turnRequest.agent_session_id).toBe("prev-session");
		});

		await runSandboxChat(makeOptions());
	});

	it("persists new session ID via upsertRuntime", async () => {
		spyForwardTurn = spyOn(
			proxyModule,
			"forwardChatTurnToSandbox",
		).mockImplementation(async (opts) => {
			// Simulate daemon sending session_id
			opts.onSessionId("new-session-123");
		});

		await runSandboxChat(makeOptions());

		expect(spyUpsertSessionId).toHaveBeenCalledWith(
			"user-1",
			"chat-1",
			"new-session-123",
		);
	});

	it("does not persist session if none received", async () => {
		spyForwardTurn = spyOn(
			proxyModule,
			"forwardChatTurnToSandbox",
		).mockResolvedValue(undefined);

		await runSandboxChat(makeOptions());

		expect(spyUpsertSessionId).not.toHaveBeenCalled();
	});

	it("maps general scope to global", async () => {
		spyForwardTurn = spyOn(
			proxyModule,
			"forwardChatTurnToSandbox",
		).mockImplementation(async (opts) => {
			expect(opts.turnRequest.scope_type).toBe("global");
		});

		await runSandboxChat(makeOptions({ scope: "general" }));
	});

	it("maps collection scope correctly", async () => {
		spyForwardTurn = spyOn(
			proxyModule,
			"forwardChatTurnToSandbox",
		).mockImplementation(async (opts) => {
			expect(opts.turnRequest.scope_type).toBe("collection");
			expect(opts.turnRequest.collection_id).toBe("col-1");
		});

		await runSandboxChat(
			makeOptions({ scope: "collection", collectionId: "col-1" }),
		);
	});

	it("maps document scope correctly", async () => {
		spyForwardTurn = spyOn(
			proxyModule,
			"forwardChatTurnToSandbox",
		).mockImplementation(async (opts) => {
			expect(opts.turnRequest.scope_type).toBe("document");
			expect(opts.turnRequest.summary_id).toBe("sum-1");
		});

		await runSandboxChat(
			makeOptions({ scope: "document", summaryId: "sum-1" }),
		);
	});

	it("propagates proxy errors", async () => {
		spyForwardTurn = spyOn(
			proxyModule,
			"forwardChatTurnToSandbox",
		).mockRejectedValue(new Error("daemon unreachable"));

		await expect(runSandboxChat(makeOptions())).rejects.toThrow(
			"daemon unreachable",
		);
	});

	it("defaults to version 0 when no runtime exists", async () => {
		spyGetTurnContext.mockResolvedValue({
			state_version: 0,
			agent_session_id: null,
		});

		spyForwardTurn = spyOn(
			proxyModule,
			"forwardChatTurnToSandbox",
		).mockImplementation(async (opts) => {
			expect(opts.turnRequest.required_version).toBe(0);
			expect(opts.turnRequest.agent_session_id).toBeUndefined();
		});

		await runSandboxChat(makeOptions());
	});
});
