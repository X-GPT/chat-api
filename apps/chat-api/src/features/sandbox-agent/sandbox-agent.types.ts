import type { Sandbox } from "e2b";
import type { ChatMessagesScope } from "@/config/env";
import type { SyncLogger } from "@/features/sandbox";

export interface SandboxAgentOptions {
	/** E2B sandbox instance */
	sandbox: Sandbox;
	/** Docs root path in sandbox, e.g. /workspace/sandbox-prototype/docs/{userId} */
	docsRoot: string;
	/** Anthropic API key — passed to sandbox via envs */
	anthropicApiKey: string;
	/** User's query */
	query: string;
	/** Chat scope */
	scope: ChatMessagesScope;
	/** Collection ID for collection scope */
	collectionId: string | null;
	/** Summary ID for document scope */
	summaryId: string | null;
	/** Session ID from a previous query — enables conversation resume */
	sessionId: string | null;
	/** Called for each text delta from the agent */
	onTextDelta: (text: string) => void;
	/** Called when the agent finishes producing text */
	onTextEnd: () => Promise<void>;
	/** Called when the agent emits a session ID for future resume */
	onSessionId?: (sessionId: string) => void;
	/** Logger */
	logger: SyncLogger;
}
