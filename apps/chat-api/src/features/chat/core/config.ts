import type { ChatMessagesScope } from "@/config/env";
import type { ProtectedSummary } from "../api/types";
import type { RequestCache } from "./cache";

export type Config = {
	memberAuthToken: string;
	scope: ChatMessagesScope;
	chatKey: string;
	collectionId: string | null;
	summaryId: string | null;
	memberCode: string;
	partnerCode: string;
	enableKnowledge: boolean;
	modelId: string;
	summaryCache: RequestCache<ProtectedSummary[]>;
};
