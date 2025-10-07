import { z } from "zod";

export const ChatRequest = z.object({
	chatContent: z.string(),
	chatKey: z.string(),
	chatType: z.string(),
	collectionId: z.string().optional().nullable(),
	summaryId: z.string().optional().nullable(),
});
export type ChatRequest = z.infer<typeof ChatRequest>;
