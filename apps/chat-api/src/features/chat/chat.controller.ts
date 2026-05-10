import { type ChatMessagesScope, isSandboxEnabled } from "@/config/env";
import { runSandboxChat } from "@/features/sandbox-orchestration";
import { adaptHistoryToModelMessages } from "./chat.adapter";
import type { ChatEntity, EventMessage } from "./chat.events";
import type { ChatLogger } from "./chat.logger";
import type { ChatRequest } from "./chat.schema";
import type { MymemoEventSender } from "./chat.streaming";
import type { ConversationHistory } from "./core/history";
import { runMyMemo } from "./core/mymemo";

const DEFAULT_MODEL_TYPE = "gpt-4o";

export async function complete(
	request: ChatRequest,
	mymemoEventSender: MymemoEventSender,
	logger: ChatLogger,
) {
	const {
		chatContent,
		chatKey,
		chatType,
		collectionId,
		summaryId,
		memberCode,
		memberName,
		teamCode,
		partnerCode,
		partnerName,
		modelType,
		enableKnowledge,
		history,
	} = request;

	const normalizedCollectionId = collectionId?.trim() ?? null;
	const normalizedSummaryId = summaryId?.trim() ?? null;

	const chatId = request.chatId ?? crypto.randomUUID();
	const refsId = request.refsId ?? crypto.randomUUID();

	const resolvedEnableKnowledge = enableKnowledge ?? false;

	let scope: ChatMessagesScope = "general";
	if (normalizedSummaryId) {
		scope = "document";
	} else if (normalizedCollectionId) {
		scope = "collection";
	}

	let accumulatedContent = "";

	const buildChatEntity = (readFlag: "0" | "1"): ChatEntity => ({
		id: chatId,
		chatKey,
		readFlag,
		delFlag: "0",
		teamCode: teamCode ?? null,
		memberCode,
		memberName: memberName ?? null,
		partnerCode,
		partnerName: partnerName ?? null,
		chatType,
		senderType: "AI",
		senderCode: partnerCode,
		chatContent: accumulatedContent,
		followup: "",
		endFlag: 1,
		collectionId: normalizedCollectionId,
		summaryId: normalizedSummaryId,
		refsId,
		collapseFlag: "1",
		refsContent: null,
	});

	const sendChatEntity = (readFlag: "0" | "1"): Promise<void> => {
		return mymemoEventSender.send({
			id: crypto.randomUUID(),
			message: {
				type: "chat_entity",
				...buildChatEntity(readFlag),
			},
		});
	};

	const onTextDelta = (text: string) => {
		accumulatedContent += text;
		// Intentional fire-and-forget on the hot path; the final entity in
		// onTextEnd is awaited so the stream is not closed before it flushes.
		void sendChatEntity("1");
	};

	const onTextEnd = async () => {
		await sendChatEntity("0");
	};

	const onEvent = (event: EventMessage) => {
		mymemoEventSender.send({
			id: crypto.randomUUID(),
			message: event,
		});
	};

	if (isSandboxEnabled() && resolvedEnableKnowledge) {
		await runSandboxChat({
			userId: memberCode,
			chatKey,
			query: chatContent,
			scope,
			collectionId: normalizedCollectionId,
			summaryId: normalizedSummaryId,
			onTextDelta,
			onTextEnd,
			logger,
		});
		return;
	}

	if (resolvedEnableKnowledge) {
		logger.warn({
			message:
				"enableKnowledge requested but sandbox path unavailable; falling back to general assistant without document access",
			chatKey,
			memberCode,
			scope,
		});
	}

	const historyMessages = adaptHistoryToModelMessages(history ?? []);
	const conversationHistory: ConversationHistory =
		historyMessages.length > 0
			? { type: "continued", messages: historyMessages }
			: { type: "new" };

	await runMyMemo({
		modelId: modelType ?? DEFAULT_MODEL_TYPE,
		conversationHistory,
		userInput: chatContent,
		onTextDelta,
		onTextEnd,
		onEvent,
		logger,
	});
}
