import type { ChatMessagesScope } from "@/config/env";

export type Config = {
	scope: ChatMessagesScope;
	chatKey: string;
	collectionId: string | null;
	summaryId: string | null;
	memberCode: string;
	partnerCode: string;
	enableKnowledge: boolean;
	modelId: string;
};
