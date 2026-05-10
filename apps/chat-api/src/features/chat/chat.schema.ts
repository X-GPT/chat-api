import { z } from "zod";

const MAX_ID_LENGTH = 256;
const MAX_NAME_LENGTH = 256;
const MAX_CHAT_TYPE_LENGTH = 64;
const MAX_MODEL_TYPE_LENGTH = 128;
const MAX_CHAT_CONTENT_LENGTH = 100_000;
const MAX_HISTORY_MESSAGES = 1_000;
const MAX_HISTORY_MESSAGE_LENGTH = 100_000;

export const ChatHistoryMessage = z.object({
	role: z.enum(["user", "assistant"]),
	content: z.string().max(MAX_HISTORY_MESSAGE_LENGTH),
});
export type ChatHistoryMessage = z.infer<typeof ChatHistoryMessage>;

export const ChatRequest = z.object({
	chatContent: z.string().min(1).max(MAX_CHAT_CONTENT_LENGTH),
	chatKey: z.string().min(1).max(MAX_ID_LENGTH),
	chatType: z.string().min(1).max(MAX_CHAT_TYPE_LENGTH),
	collectionId: z.string().max(MAX_ID_LENGTH).optional().nullable(),
	summaryId: z.string().max(MAX_ID_LENGTH).optional().nullable(),

	memberCode: z.string().min(1).max(MAX_ID_LENGTH),
	memberName: z.string().max(MAX_NAME_LENGTH).optional().nullable(),
	teamCode: z.string().max(MAX_ID_LENGTH).optional().nullable(),
	partnerCode: z.string().min(1).max(MAX_ID_LENGTH),
	partnerName: z.string().max(MAX_NAME_LENGTH).optional().nullable(),

	modelType: z.string().min(1).max(MAX_MODEL_TYPE_LENGTH).optional(),
	enableKnowledge: z.boolean().optional(),

	chatId: z.string().uuid().optional(),
	refsId: z.string().uuid().optional(),

	history: z.array(ChatHistoryMessage).max(MAX_HISTORY_MESSAGES).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequest>;
