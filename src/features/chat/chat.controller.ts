import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import type { ChatRequest } from "./chat.schema";
import type { MymemoEventSender } from "./chat.streaming";

export async function complete(
	{ chatContent, chatKey, chatType, collectionId, summaryId }: ChatRequest,
	mymemoEventSender: MymemoEventSender,
) {
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

	for await (const textPart of result.textStream) {
		accumulatedContent += textPart;

		mymemoEventSender.send({
			id: crypto.randomUUID(),
			message: {
				type: "chat_entity",
				chatContent: accumulatedContent,
				refsContent: "",
				chatKey: chatKey,
				chatType: chatType,
				createBy: "",
				createTime: "",
				delFlag: "",
				followup: "",
				id: 0,
				memberCode: "",
				memberName: "",
				partnerCode: "",
				partnerName: "",
				readFlag: "",
				remark: "",
				senderCode: "",
				senderType: "",
				updateBy: "",
				updateTime: "",
				violateFlag: "",
				// 折叠标志（1代表展开 2代表折叠）
				collapseFlag: "1",
				voteType: 0,
			},
		});
	}
}
