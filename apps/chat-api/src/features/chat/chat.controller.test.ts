import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import * as envModule from "@/config/env";

Bun.env.OPENAI_API_KEY = Bun.env.OPENAI_API_KEY ?? "test-openai-key";
Bun.env.ANTHROPIC_API_KEY = Bun.env.ANTHROPIC_API_KEY ?? "test-anthropic-key";
Bun.env.DEEPSEEK_API_KEY = Bun.env.DEEPSEEK_API_KEY ?? "test-deepseek-key";
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

describe("complete sandbox routing", () => {
	let sandboxModule: typeof import("@/features/sandbox-orchestration");
	let mymemoModule: typeof import("./core/mymemo");
	let controllerModule: typeof import("./chat.controller");

	beforeEach(async () => {
		spyOn(envModule, "isSandboxEnabled").mockReturnValue(true);
		sandboxModule = await import("@/features/sandbox-orchestration");
		mymemoModule = await import("./core/mymemo");
		controllerModule = await import("./chat.controller");
	});

	afterEach(() => {
		mock.restore();
	});

	it("uses sandbox chat when sandbox is enabled and credentials present", async () => {
		const spySandbox = spyOn(sandboxModule, "runSandboxChat").mockResolvedValue(
			{
				status: "completed",
			},
		);
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
				memberCode: "user-1",
				partnerCode: "partner-1",
				modelType: "gpt-4o",
				enableKnowledge: true,
			},
			sender as unknown as import("./chat.streaming").MymemoEventSender,
			silentLogger as unknown as import("./chat.logger").ChatLogger,
		);

		expect(spySandbox).toHaveBeenCalled();
		expect(spyRunMyMemo).not.toHaveBeenCalled();
	});

	it("falls back to runMyMemo when enableKnowledge is false", async () => {
		const spySandbox = spyOn(sandboxModule, "runSandboxChat").mockResolvedValue(
			{
				status: "completed",
			},
		);
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
				memberCode: "user-1",
				partnerCode: "partner-1",
				modelType: "gpt-4o",
				enableKnowledge: false,
			},
			sender as unknown as import("./chat.streaming").MymemoEventSender,
			silentLogger as unknown as import("./chat.logger").ChatLogger,
		);

		expect(spyRunMyMemo).toHaveBeenCalled();
		expect(spySandbox).not.toHaveBeenCalled();
	});
});
