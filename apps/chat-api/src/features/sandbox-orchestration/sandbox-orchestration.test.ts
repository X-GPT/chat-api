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
		sessionId: null,
		sandboxId: null,
		onTextDelta: async () => {},
		onTextEnd: async () => {},
		onSessionId: async () => {},
		onSandboxId: async () => {},
		logger: silentLogger,
		...overrides,
	};
}

describe("runSandboxChat", () => {
	let runSandboxChat: typeof import("./sandbox-orchestration").runSandboxChat;
	let singletonModule: typeof import("./singleton");
	let proxyModule: typeof import("./sandbox-proxy");
	let spyGetOrCreate: ReturnType<typeof spyOn>;
	let spyEnsureDaemon: ReturnType<typeof spyOn>;
	let spyForwardTurn: ReturnType<typeof spyOn>;

	beforeEach(async () => {
		Bun.env.OPENAI_API_KEY = "test-openai-key";
		Bun.env.ANTHROPIC_API_KEY = "test-anthropic-key";
		Bun.env.DEEPSEEK_API_KEY = "test-deepseek-key";
		Bun.env.E2B_API_KEY = "test-e2b-key";
		Bun.env.DATABASE_URL = "mysql://user:pass@localhost:3306/test";
		({ runSandboxChat } = await import("./sandbox-orchestration"));
		singletonModule = await import("./singleton");
		proxyModule = await import("./sandbox-proxy");

		const sandbox = createMockSandbox();
		spyGetOrCreate = spyOn(
			singletonModule.sandboxManager,
			"getOrCreateSandbox",
		).mockResolvedValue(sandbox as unknown as import("e2b").Sandbox);
		spyEnsureDaemon = spyOn(
			singletonModule.sandboxManager,
			"ensureSandboxDaemon",
		).mockResolvedValue({
			url: "http://daemon:8080",
			authToken: "daemon-token",
		});
	});

	afterEach(() => {
		spyGetOrCreate?.mockRestore();
		spyEnsureDaemon?.mockRestore();
		spyForwardTurn?.mockRestore();
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
		expect(spyForwardTurn).toHaveBeenCalledWith(
			expect.objectContaining({
				daemonUrl: "http://daemon:8080",
				daemonAuthToken: "daemon-token",
			}),
		);
	});

	it("forwards request sessionId as agent_session_id", async () => {
		spyForwardTurn = spyOn(
			proxyModule,
			"forwardChatTurnToSandbox",
		).mockImplementation(async (opts) => {
			expect(opts.turnRequest.agent_session_id).toBe("client-session");
		});

		await runSandboxChat(makeOptions({ sessionId: "client-session" }));
	});

	it("omits agent_session_id when no sessionId provided", async () => {
		spyForwardTurn = spyOn(
			proxyModule,
			"forwardChatTurnToSandbox",
		).mockImplementation(async (opts) => {
			expect(opts.turnRequest.agent_session_id).toBeUndefined();
		});

		await runSandboxChat(makeOptions({ sessionId: null }));
	});

	it("forwards request sandboxId to sandbox manager", async () => {
		spyForwardTurn = spyOn(
			proxyModule,
			"forwardChatTurnToSandbox",
		).mockResolvedValue(undefined);

		await runSandboxChat(makeOptions({ sandboxId: "sbx-from-client" }));

		expect(spyGetOrCreate).toHaveBeenCalledWith(
			"user-1",
			"sbx-from-client",
			expect.anything(),
		);
	});

	it("passes null sandboxId when none provided", async () => {
		spyForwardTurn = spyOn(
			proxyModule,
			"forwardChatTurnToSandbox",
		).mockResolvedValue(undefined);

		await runSandboxChat(makeOptions({ sandboxId: null }));

		expect(spyGetOrCreate).toHaveBeenCalledWith(
			"user-1",
			null,
			expect.anything(),
		);
	});

	it("invokes onSandboxId with the resolved sandbox id", async () => {
		spyForwardTurn = spyOn(
			proxyModule,
			"forwardChatTurnToSandbox",
		).mockResolvedValue(undefined);

		const received: string[] = [];
		await runSandboxChat(
			makeOptions({
				onSandboxId: async (id) => {
					received.push(id);
				},
			}),
		);

		expect(received).toEqual(["sbx-123"]);
	});

	it("surfaces daemon-emitted session_id via callback", async () => {
		const received: string[] = [];
		spyForwardTurn = spyOn(
			proxyModule,
			"forwardChatTurnToSandbox",
		).mockImplementation(async (opts) => {
			await opts.onSessionId("new-session-123");
		});

		await runSandboxChat(
			makeOptions({
				onSessionId: async (id) => {
					received.push(id);
				},
			}),
		);

		expect(received).toEqual(["new-session-123"]);
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
});
