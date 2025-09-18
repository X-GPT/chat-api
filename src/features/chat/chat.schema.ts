import { z } from "zod";

export type ChatRequest = z.infer<typeof ChatRequest>;

export const ChatRequest = z.object({
	chatContent: z.string(),
	chatKey: z.string(),
	chatType: z.string(),
	collectionId: z.string().nullable(),
	summaryId: z.string().nullable(),
});
