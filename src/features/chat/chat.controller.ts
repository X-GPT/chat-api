import type { ModelMessage } from "ai";
import { streamText } from "ai";
import { adaptProtectedMessagesToModelMessages } from "./chat.adapter";
import type { ChatConfig } from "./chat.config";
import type { ChatEntity } from "./chat.events";
import {
	fetchProtectedChatContext,
	fetchProtectedChatId,
	fetchProtectedChatMessages,
	fetchProtectedFileDetail,
	sendChatEntityToProtectedService,
} from "./chat.external";
import { resolveLanguageModel } from "./chat.language-models";
import type { ChatLogger } from "./chat.logger";
import type { ChatRequest } from "./chat.schema";
import type { MymemoEventSender } from "./chat.streaming";

export async function complete(
	{ chatContent, chatKey, chatType, collectionId, summaryId }: ChatRequest,
	config: ChatConfig,
	mymemoEventSender: MymemoEventSender,
	logger: ChatLogger,
) {
	const protectedFetchOptions = {
		memberAuthToken: config.memberAuthToken,
	};

	const normalizedSummaryId = summaryId?.trim() ?? null;

	const summaryFileDetailPromise = normalizedSummaryId
		? fetchProtectedFileDetail(
				chatType,
				normalizedSummaryId,
				protectedFetchOptions,
				logger,
			)
		: Promise.resolve(null);

	const [summaryFileMetadata, chatId, chatContext, chatHistory] =
		await Promise.all([
			summaryFileDetailPromise,
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
					size: 1000,
					scope: summaryId
						? "document"
						: collectionId
							? "collection"
							: "general",
				},
				protectedFetchOptions,
				logger,
			),
		]);

	// TODO: remove this after debugging
	console.debug({
		summaryFileMetadata,
	});

	const contextChatData = chatContext.chatData;
	const resolvedMemberCode =
		contextChatData?.memberCode ?? config.memberCode ?? "";
	const resolvedMemberName = contextChatData?.nickName ?? "";
	const resolvedPartnerCode = contextChatData?.partnerCode ?? "";
	const resolvedPartnerName = contextChatData?.partnerName ?? "";
	const resolvedSenderCode = contextChatData?.teamCode ?? "";
	const resolvedModelType = contextChatData?.modelType ?? "gpt-4o";

	const historyMessages = adaptProtectedMessagesToModelMessages(chatHistory);

	const messages: ModelMessage[] = [
		...historyMessages,
		{
			role: "user" as const,
			content: [{ type: "text" as const, text: chatContent }],
		},
	];
	const {
		model: languageModel,
		isFallback,
		requestedModelId,
		modelId,
	} = resolveLanguageModel(resolvedModelType);

	if (isFallback) {
		logger.info({
			message: "Requested model type is not supported; using fallback model",
			requestedModelType: requestedModelId ?? resolvedModelType,
			fallbackModelType: modelId,
		});
	}

	const result = streamText({
		model: languageModel,
		system: "You are a helpful assistant.",
		messages,
	});

	let accumulatedContent = "";

	let lastChatEntity: ChatEntity | null = null;

	for await (const event of result.fullStream) {
		switch (event.type) {
			case "text-delta": {
				accumulatedContent += event.text;

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
				break;
			}
			case "text-end": {
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
				break;
			}
		}
	}
}
