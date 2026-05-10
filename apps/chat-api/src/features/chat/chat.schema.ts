import { z } from "zod";

export const ChatHistoryMessage = z.object({
	role: z.enum(["user", "assistant"]),
	content: z.string(),
});
export type ChatHistoryMessage = z.infer<typeof ChatHistoryMessage>;

export const ChatRequest = z.object({
	chatContent: z.string(),
	chatKey: z.string(),
	chatType: z.string(),
	collectionId: z.string().optional().nullable(),
	summaryId: z.string().optional().nullable(),

	memberCode: z.string(),
	memberName: z.string().optional().nullable(),
	teamCode: z.string().optional().nullable(),
	partnerCode: z.string(),
	partnerName: z.string().optional().nullable(),

	modelType: z.string().optional(),
	enableKnowledge: z.boolean().optional(),

	chatId: z.string().optional(),
	refsId: z.string().optional(),

	history: z.array(ChatHistoryMessage).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequest>;
