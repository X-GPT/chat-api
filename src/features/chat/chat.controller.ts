import type { ChatMessagesScope } from "@/config/env";
import { adaptProtectedMessagesToModelMessages } from "./chat.adapter";
import type { ChatConfig } from "./chat.config";
import type { ChatEntity } from "./chat.events";
import {
	fetchProtectedChatContext,
	fetchProtectedChatId,
	fetchProtectedChatMessages,
	sendChatEntityToProtectedService,
} from "./chat.external";
import type { ChatLogger } from "./chat.logger";
import type { ChatRequest } from "./chat.schema";
import type { MymemoEventSender } from "./chat.streaming";
import type { Config } from "./core/config";
import type { ConversationHistory } from "./core/history";
import { runMyMemo } from "./core/mymemo";

export async function complete(
	{ chatContent, chatKey, chatType, collectionId, summaryId }: ChatRequest,
	config: ChatConfig,
	mymemoEventSender: MymemoEventSender,
	logger: ChatLogger,
) {
	const protectedFetchOptions = {
		memberAuthToken: config.memberAuthToken,
	};

	const normalizeCollectionId = collectionId?.trim() ?? null;
	const normalizedSummaryId = summaryId?.trim() ?? null;

	const [chatId, chatContext, chatHistory] = await Promise.all([
		fetchProtectedChatId(protectedFetchOptions, logger),
		fetchProtectedChatContext(
			chatKey,
			collectionId,
			summaryId,
			protectedFetchOptions,
			logger,
		),
		fetchProtectedChatMessages(
			chatKey,
			{
				collectionId,
				summaryId,
				memberCode: config.memberCode,
				scope: summaryId ? "document" : collectionId ? "collection" : "general",
				size: 1000,
			},
			protectedFetchOptions,
			logger,
		),
	]);

	const contextChatData = chatContext.chatData;
	const resolvedMemberCode =
		contextChatData?.memberCode ?? config.memberCode ?? "";
	const resolvedMemberName = contextChatData?.nickName ?? "";
	const resolvedPartnerCode = contextChatData?.partnerCode ?? "";
	const resolvedPartnerName = contextChatData?.partnerName ?? "";
	const resolvedSenderCode = contextChatData?.teamCode ?? "";
	const resolvedModelType = contextChatData?.modelType ?? "gpt-4o";

	const historyMessages = adaptProtectedMessagesToModelMessages(chatHistory);

	let scope: ChatMessagesScope = "general";
	if (chatContext.collectionId) {
		scope = "collection";
	} else if (chatContext.summaryId) {
		scope = "document";
	}

	const mymemoConfig: Config = {
		scope,
		memberAuthToken: config.memberAuthToken,
		chatKey,
		collectionId: normalizeCollectionId,
		summaryId: normalizedSummaryId,
		modelId: resolvedModelType,
	};

	let conversationHistory: ConversationHistory = {
		type: "new",
	};
	if (historyMessages.length > 0) {
		conversationHistory = {
			type: "continued",
			messages: historyMessages,
		};
	}

	let accumulatedContent = "";

	let lastChatEntity: ChatEntity | null = null;

	await runMyMemo({
		config: mymemoConfig,
		conversationHistory,
		userInput: chatContent,
		onTextDelta: (text) => {
			accumulatedContent += text;
			const chatEntity: ChatEntity = {
				chatContent: accumulatedContent,
				refsContent: "",
				chatKey,
				chatType,
				createBy: "",
				createTime: "",
				delFlag: "0",
				followup: "",
				id: chatId,
				memberCode: resolvedMemberCode,
				memberName: resolvedMemberName,
				partnerCode: resolvedPartnerCode,
				partnerName: resolvedPartnerName,
				readFlag: "1",
				remark: "",
				senderCode: resolvedSenderCode,
				// 发送者类型（AI/User）
				senderType: "AI",
				updateBy: "",
				updateTime: "",
				violateFlag: "",
				// 折叠标志（1代表展开 2代表折叠）
				collapseFlag: "1",
				voteType: 0,
			};

			lastChatEntity = chatEntity;

			mymemoEventSender.send({
				id: crypto.randomUUID(),
				message: {
					type: "chat_entity",
					...chatEntity,
				},
			});
		},
		onTextEnd: async () => {
			if (lastChatEntity) {
				lastChatEntity.readFlag = "0";
				await sendChatEntityToProtectedService(
					lastChatEntity,
					protectedFetchOptions,
					logger,
				);
			} else {
				logger.error({
					message: "Last chat entity is null",
				});
				throw new Error("Last chat entity is null");
			}
		},
		onEvent: (event) => {
			mymemoEventSender.send({
				id: crypto.randomUUID(),
				message: event,
			});
		},
		logger,
	});
}
