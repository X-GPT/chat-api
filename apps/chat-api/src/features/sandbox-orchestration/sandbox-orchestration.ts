import { apiEnv } from "@/config/env";
import type { ChatMessagesScope } from "@/config/env";
import type { ChatLogger } from "@/features/chat/chat.logger";
import { runSandboxAgent } from "@/features/sandbox-agent";
import { SandboxCreationError, SandboxSyncError } from "./errors";
import { sandboxManager, sessionStore } from "./singleton";

export interface RunSandboxChatOptions {
	userId: string;
	query: string;
	scope: ChatMessagesScope;
	collectionId: string | null;
	summaryId: string | null;
	chatKey: string;
	syncEndpointOrigin: string;
	onTextDelta: (text: string) => void;
	onTextEnd: () => Promise<void>;
	logger: ChatLogger;
}

function isSandboxInfraError(err: unknown): boolean {
	return err instanceof SandboxCreationError || err instanceof SandboxSyncError;
}

export async function runSandboxChat(
	options: RunSandboxChatOptions,
): Promise<void> {
	const {
		userId,
		query,
		scope,
		collectionId,
		summaryId,
		chatKey,
		syncEndpointOrigin,
		onTextDelta,
		onTextEnd,
		logger,
	} = options;

	const attempt = async () => {
		const sandbox = await sandboxManager.ensureReady(
			userId,
			syncEndpointOrigin,
			logger,
		);

		const sessionId = sessionStore.getSessionId(chatKey);
		const docsRoot = sandboxManager.getDocsRoot(userId);

		let newSessionId: string | null = null;

		await runSandboxAgent({
			sandbox,
			docsRoot,
			anthropicApiKey: apiEnv.ANTHROPIC_API_KEY,
			query,
			scope,
			collectionId,
			summaryId,
			sessionId,
			onTextDelta,
			onTextEnd,
			onSessionId: (id) => {
				newSessionId = id;
			},
			logger,
		});

		if (newSessionId) {
			sessionStore.setSessionId(chatKey, newSessionId, userId);
		}
	};

	try {
		await attempt();
	} catch (err) {
		// Only retry infrastructure errors (sandbox creation/sync).
		// Agent errors (LLM failures, prompt issues) are not transient.
		if (!isSandboxInfraError(err)) {
			throw err;
		}

		logger.error({
			msg: "Sandbox infra failed, retrying with fresh sandbox",
			userId,
			error: err instanceof Error ? err.message : String(err),
		});

		sessionStore.removeUserSessions(userId);

		// Retry once — ensureReady will create a fresh sandbox
		// since the old one likely failed or is unreachable
		await attempt();
	}
}
