import type { ChatMessagesScope } from "@/config/env";

export type Config = {
	scope: ChatMessagesScope;
	enableKnowledge: boolean;
	modelId: string;
};
