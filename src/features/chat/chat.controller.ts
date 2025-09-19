import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import type { ChatEntity } from "./chat.events";
import {
	fetchProtectedChatId,
	sendChatEntityToProtectedService,
} from "./chat.external";
import type { ChatRequest } from "./chat.schema";
import type { MymemoEventSender } from "./chat.streaming";

export async function complete(
	{ chatContent, chatKey, chatType, collectionId, summaryId }: ChatRequest,
	mymemoEventSender: MymemoEventSender,
) {
	const chatId = await fetchProtectedChatId();

	const messages = [
		{
			role: "user" as const,
			content: [{ type: "text" as const, text: chatContent }],
		},
	];
	const result = streamText({
		model: openai("gpt-4o"),
		system: "You are a helpful assistant.",
		messages,
	});

	let accumulatedContent = "";

	let lastChatEntity: ChatEntity | null = null;

	for await (const textPart of result.textStream) {
		accumulatedContent += textPart;

		const chatEntity: ChatEntity = {
			chatContent: accumulatedContent,
			refsContent: "",
			chatKey,
			chatType,
			createBy: "",
			createTime: "",
			delFlag: "",
			followup: "",
			id: chatId,
			memberCode: "",
			memberName: "",
			partnerCode: "",
			partnerName: "",
			readFlag: "",
			remark: "",
			senderCode: "",
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
	}

	if (lastChatEntity) {
		await sendChatEntityToProtectedService(lastChatEntity);
	}
}
