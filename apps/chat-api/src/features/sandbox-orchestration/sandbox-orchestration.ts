import type { ChatMessagesScope } from "@/config/env";
import { apiEnv } from "@/config/env";
import type { ChatLogger } from "@/features/chat/chat.logger";
import { runSandboxAgent } from "@/features/sandbox-agent";
import { SandboxCreationError } from "./errors";
import { sandboxManager, sessionStore } from "./singleton";

export interface RunSandboxChatOptions {
	userId: string;
	query: string;
	scope: ChatMessagesScope;
	collectionId: string | null;
	summaryId: string | null;
	chatKey: string;
	onTextDelta: (text: string) => void;
	onTextEnd: () => Promise<void>;
	logger: ChatLogger;
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
		onTextDelta,
		onTextEnd,
		logger,
	} = options;

	const attempt = async () => {
		const sandbox = await sandboxManager.getOrCreateSandbox(userId, logger);
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
		if (!(err instanceof SandboxCreationError)) {
			throw err;
		}

		logger.error({
			msg: "Sandbox creation failed, retrying",
			userId,
			error: err.message,
		});

		sessionStore.removeUserSessions(userId);
		await attempt();
	}
}
