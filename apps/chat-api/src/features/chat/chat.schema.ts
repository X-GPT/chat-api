import { z } from "zod";

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_CHAT_TYPE_LENGTH = 64;
const MAX_MODEL_TYPE_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 50_000;
const MAX_HISTORY_MESSAGES = 1_000;

export const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

export const ChatHistoryMessage = z.object({
	role: z.enum(["user", "assistant"]),
	content: z.string().max(MAX_MESSAGE_LENGTH),
});
export type ChatHistoryMessage = z.infer<typeof ChatHistoryMessage>;

export const ChatRequest = z.object({
	chatContent: z.string().min(1).max(MAX_MESSAGE_LENGTH),
	chatKey: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
	chatType: z.string().min(1).max(MAX_CHAT_TYPE_LENGTH),
	collectionId: z.string().max(MAX_IDENTIFIER_LENGTH).nullish(),
	summaryId: z.string().max(MAX_IDENTIFIER_LENGTH).nullish(),

	memberCode: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
	memberName: z.string().max(MAX_IDENTIFIER_LENGTH).nullish(),
	teamCode: z.string().max(MAX_IDENTIFIER_LENGTH).nullish(),
	partnerCode: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
	partnerName: z.string().max(MAX_IDENTIFIER_LENGTH).nullish(),

	modelType: z.string().min(1).max(MAX_MODEL_TYPE_LENGTH).optional(),
	enableKnowledge: z.boolean().optional(),

	chatId: z.string().uuid().optional(),
	refsId: z.string().uuid().optional(),

	history: z.array(ChatHistoryMessage).max(MAX_HISTORY_MESSAGES).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequest>;
