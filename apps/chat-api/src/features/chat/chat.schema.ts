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

// Public chat payload — what an external client can supply.
// Identity (memberCode/partnerCode/etc.) is intentionally NOT part of the
// body; it must arrive via trusted internal headers (see InternalIdentity).
// `.strict()` rejects any extra keys, including identity fields, to keep the
// trust boundary unambiguous.
export const ChatBodyRequest = z
	.object({
		chatContent: z.string().min(1).max(MAX_MESSAGE_LENGTH),
		chatKey: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
		chatType: z.string().min(1).max(MAX_CHAT_TYPE_LENGTH),
		collectionId: z.string().max(MAX_IDENTIFIER_LENGTH).nullish(),
		summaryId: z.string().max(MAX_IDENTIFIER_LENGTH).nullish(),

		modelType: z.string().min(1).max(MAX_MODEL_TYPE_LENGTH).optional(),
		enableKnowledge: z.boolean().optional(),

		chatId: z.string().uuid().optional(),
		refsId: z.string().uuid().optional(),

		history: z.array(ChatHistoryMessage).max(MAX_HISTORY_MESSAGES).optional(),
	})
	.strict();
export type ChatBodyRequest = z.infer<typeof ChatBodyRequest>;

// Identity injected by trusted internal callers via X-* headers. Treated as
// authoritative — chat-api itself does not authenticate; the internal caller
// (gateway / BFF) is responsible for verifying the user before forwarding.
export const InternalIdentity = z.object({
	memberCode: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
	memberName: z.string().max(MAX_IDENTIFIER_LENGTH).optional(),
	teamCode: z.string().max(MAX_IDENTIFIER_LENGTH).optional(),
	partnerCode: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
	partnerName: z.string().max(MAX_IDENTIFIER_LENGTH).optional(),
});
export type InternalIdentity = z.infer<typeof InternalIdentity>;

export type ChatRequest = ChatBodyRequest & InternalIdentity;
