import type { ChatMessagesScope } from "@/config/env";
import { adaptProtectedMessagesToModelMessages } from "./chat.adapter";
import type { ChatConfig } from "./chat.config";
import type { ChatEntity, Citation } from "./chat.events";
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

	const [chatId, refsId, chatContext, chatHistory] = await Promise.all([
		fetchProtectedChatId(protectedFetchOptions, logger),
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
				scope: summaryId ? "document" : collectionId ? "collection" : "general",
				size: 1000,
			},
			protectedFetchOptions,
			logger,
		),
	]);

	const contextChatData = chatContext.chatData;
	const resolvedMemberCode =
		contextChatData?.memberCode ?? config.memberCode ?? null;
	const resolvedMemberName = contextChatData?.nickName ?? null;
	const resolvedTeamCode = contextChatData?.teamCode ?? null;
	const resolvedPartnerCode = contextChatData?.partnerCode ?? null;
	const resolvedPartnerName = contextChatData?.partnerName ?? null;
	const resolvedSenderCode = contextChatData?.partnerCode ?? null;
	const resolvedModelType = contextChatData?.modelType ?? "gpt-4o";
	const resolvedEnableKnowledge = contextChatData?.enableKnowledge ?? 2;

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
		memberCode: resolvedMemberCode,
		partnerCode: resolvedPartnerCode ?? "",
		enableKnowledge: resolvedEnableKnowledge === 1,
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
	const accumulatedCitations: Citation[] = [];

	await runMyMemo({
		config: mymemoConfig,
		conversationHistory,
		userInput: chatContent,
		onTextDelta: (text) => {
			accumulatedContent += text;
			const chatEntity: ChatEntity = {
				id: chatId,
				chatKey,
				readFlag: "1",
				delFlag: "0",
				teamCode: resolvedTeamCode,
				memberCode: resolvedMemberCode,
				memberName: resolvedMemberName,
				partnerCode: resolvedPartnerCode,
				partnerName: resolvedPartnerName,
				chatType,
				senderType: "AI",
				senderCode: resolvedSenderCode,
				chatContent: accumulatedContent,
				followup: "",
				endFlag: 1,
				collectionId: normalizeCollectionId,
				summaryId: normalizedSummaryId,
				refsId: refsId,
				// Only send the not collapsed messages
				collapseFlag: "1",
				refsContent: null,
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
				lastChatEntity.refsContent = JSON.stringify(accumulatedCitations);
				await sendChatEntityToProtectedService(
					lastChatEntity,
					protectedFetchOptions,
					logger,
				);

				if (accumulatedCitations.length > 0) {
					const chatEntity: ChatEntity = {
						id: chatId,
						chatKey,
						readFlag: "0",
						delFlag: "0",
						teamCode: resolvedTeamCode,
						memberCode: resolvedMemberCode,
						memberName: resolvedMemberName,
						partnerCode: resolvedPartnerCode,
						partnerName: resolvedPartnerName,
						chatType: "refs",
						senderType: "AI",
						senderCode: resolvedSenderCode,
						chatContent: JSON.stringify(accumulatedCitations),
						followup: "",
						endFlag: 1,
						collectionId: normalizeCollectionId,
						summaryId: normalizedSummaryId,
						refsId: refsId,
						// Only send the not collapsed messages
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
					await sendChatEntityToProtectedService(
						chatEntity,
						protectedFetchOptions,
						logger,
					);
				}
			} else {
				logger.error({
					message: "Last chat entity is null",
				});
				throw new Error("Last chat entity is null");
			}
		},
		onCitationsUpdate: (citations) => {
			accumulatedCitations.push(...citations);
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
