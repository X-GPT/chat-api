import { type ChatMessagesScope, isSandboxEnabled } from "@/config/env";
import { runSandboxChat } from "@/features/sandbox-orchestration";
import { adaptHistoryToModelMessages } from "./chat.adapter";
import type { ChatEntity, EventMessage } from "./chat.events";
import type { ChatLogger } from "./chat.logger";
import type { ChatRequest } from "./chat.schema";
import type { MymemoEventSender } from "./chat.streaming";
import type { Config } from "./core/config";
import type { ConversationHistory } from "./core/history";
import { runMyMemo } from "./core/mymemo";

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

	const resolvedModelType = modelType ?? "gpt-4o";
	const resolvedEnableKnowledge = enableKnowledge ?? false;

	const historyMessages = adaptHistoryToModelMessages(history ?? []);

	let scope: ChatMessagesScope = "general";
	if (normalizedSummaryId) {
		scope = "document";
	} else if (normalizedCollectionId) {
		scope = "collection";
	}

	const mymemoConfig: Config = {
		scope,
		chatKey,
		collectionId: normalizedCollectionId,
		summaryId: normalizedSummaryId,
		modelId: resolvedModelType,
		memberCode,
		partnerCode,
		enableKnowledge: resolvedEnableKnowledge,
	};

	const conversationHistory: ConversationHistory =
		historyMessages.length > 0
			? { type: "continued", messages: historyMessages }
			: { type: "new" };

	let accumulatedContent = "";

	const onTextDelta = (text: string) => {
		accumulatedContent += text;
		const chatEntity: ChatEntity = {
			id: chatId,
			chatKey,
			readFlag: "1",
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
		};

		mymemoEventSender.send({
			id: crypto.randomUUID(),
			message: {
				type: "chat_entity",
				...chatEntity,
			},
		});
	};

	const onTextEnd = async () => {
		const chatEntity: ChatEntity = {
			id: chatId,
			chatKey,
			readFlag: "0",
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
		};

		mymemoEventSender.send({
			id: crypto.randomUUID(),
			message: {
				type: "chat_entity",
				...chatEntity,
			},
		});
	};

	const onEvent = (event: EventMessage) => {
		mymemoEventSender.send({
			id: crypto.randomUUID(),
			message: event,
		});
	};

	if (isSandboxEnabled() && resolvedEnableKnowledge && memberCode && partnerCode) {
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
	} else {
		await runMyMemo({
			config: mymemoConfig,
			conversationHistory,
			userInput: chatContent,
			onTextDelta,
			onTextEnd,
			onEvent,
			logger,
		});
	}
}
