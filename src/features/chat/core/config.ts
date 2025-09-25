import type { ChatMessagesScope } from "@/config/env";

export type Config = {
	memberAuthToken: string;
	scope: ChatMessagesScope;
	chatKey: string;
	collectionId: string | null;
	summaryId: string | null;

	modelId: string;
};
