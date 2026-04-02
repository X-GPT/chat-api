import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as envModule from "@/config/env";

Bun.env.OPENAI_API_KEY = Bun.env.OPENAI_API_KEY ?? "test-openai-key";
Bun.env.ANTHROPIC_API_KEY = Bun.env.ANTHROPIC_API_KEY ?? "test-anthropic-key";
Bun.env.PROTECTED_API_TOKEN = Bun.env.PROTECTED_API_TOKEN ?? "test-token";
Bun.env.E2B_API_KEY = Bun.env.E2B_API_KEY ?? "test-e2b-key";

const silentLogger = {
	info(_obj: Record<string, unknown>) {},
	error(_obj: Record<string, unknown>) {},
	warn(_obj: Record<string, unknown>) {},
	debug(_obj: Record<string, unknown>) {},
	child() {
		return this;
	},
};

const sender = {
	send(_event: unknown) {},
};

describe("complete sandbox fallback", () => {
	let chatApiModule: typeof import("./api/chat");
	let summariesModule: typeof import("./api/summaries");
	let sandboxModule: typeof import("@/features/sandbox-orchestration");
	let mymemoModule: typeof import("./core/mymemo");
	let controllerModule: typeof import("./chat.controller");

	beforeEach(async () => {
		spyOn(envModule, "isSandboxEnabled").mockReturnValue(true);
		chatApiModule = await import("./api/chat");
		summariesModule = await import("./api/summaries");
		sandboxModule = await import("@/features/sandbox-orchestration");
		mymemoModule = await import("./core/mymemo");
		controllerModule = await import("./chat.controller");
	});

	afterEach(() => {
		mock.restore();
	});

	it("falls back to runMyMemo when sandbox chat is still syncing", async () => {
		spyOn(chatApiModule, "fetchProtectedChatId").mockResolvedValueOnce(
			"chat-id",
		).mockResolvedValueOnce("refs-id");
		spyOn(chatApiModule, "fetchProtectedChatContext").mockResolvedValue({
			chatKey: "chat-1",
			chatData: {
				memberCode: "user-1",
				partnerCode: "partner-1",
				enableKnowledge: 1,
				modelType: "gpt-4o",
			},
		});
		spyOn(chatApiModule, "fetchProtectedChatMessages").mockResolvedValue([]);
		spyOn(summariesModule, "fetchProtectedSummaries").mockResolvedValue([]);

		const spySandbox = spyOn(sandboxModule, "runSandboxChat").mockResolvedValue({
			status: "syncing",
		});
		const spyRunMyMemo = spyOn(mymemoModule, "runMyMemo").mockResolvedValue(
			undefined,
		);

		await controllerModule.complete(
			{
				chatContent: "hello",
				chatKey: "chat-1",
				chatType: "text",
				collectionId: null,
				summaryId: null,
			},
			{
				memberAuthToken: "token-123",
				memberCode: "user-1",
			},
			sender as any,
			silentLogger as any,
		);

		expect(spySandbox).toHaveBeenCalled();
		expect(spyRunMyMemo).toHaveBeenCalled();
	});

	it("uses sandbox chat only when the sandbox is ready", async () => {
		spyOn(chatApiModule, "fetchProtectedChatId").mockResolvedValueOnce(
			"chat-id",
		).mockResolvedValueOnce("refs-id");
		spyOn(chatApiModule, "fetchProtectedChatContext").mockResolvedValue({
			chatKey: "chat-1",
			chatData: {
				memberCode: "user-1",
				partnerCode: "partner-1",
				enableKnowledge: 1,
				modelType: "gpt-4o",
			},
		});
		spyOn(chatApiModule, "fetchProtectedChatMessages").mockResolvedValue([]);
		spyOn(summariesModule, "fetchProtectedSummaries").mockResolvedValue([]);

		const spySandbox = spyOn(sandboxModule, "runSandboxChat").mockResolvedValue({
			status: "completed",
		});
		const spyRunMyMemo = spyOn(mymemoModule, "runMyMemo").mockResolvedValue(
			undefined,
		);

		await controllerModule.complete(
			{
				chatContent: "hello",
				chatKey: "chat-1",
				chatType: "text",
				collectionId: null,
				summaryId: null,
			},
			{
				memberAuthToken: "token-123",
				memberCode: "user-1",
			},
			sender as any,
			silentLogger as any,
		);

		expect(spySandbox).toHaveBeenCalled();
		expect(spyRunMyMemo).not.toHaveBeenCalled();
	});
});
