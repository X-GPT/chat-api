import type { ChatMessagesScope } from "@/config/env";
import { apiEnv } from "@/config/env";
import type { ChatLogger } from "@/features/chat/chat.logger";
import { runSandboxAgent } from "@/features/sandbox-agent";
import { SandboxCreationError } from "./errors";
import {
	startInitialSyncIfNeeded,
	runIncrementalSync,
} from "./sandbox-sync-service";
import { sandboxManager, sessionStore } from "./singleton";

export interface RunSandboxChatOptions {
	userId: string;
	query: string;
	scope: ChatMessagesScope;
	collectionId: string | null;
	summaryId: string | null;
	chatKey: string;
	memberCode: string;
	partnerCode: string;
	memberAuthToken: string;
	onTextDelta: (text: string) => void;
	onTextEnd: () => Promise<void>;
	logger: ChatLogger;
}

export type RunSandboxChatResult =
	| { status: "completed" }
	| { status: "syncing" };

export async function runSandboxChat(
	options: RunSandboxChatOptions,
): Promise<RunSandboxChatResult> {
	const {
		userId,
		query,
		scope,
		collectionId,
		summaryId,
		chatKey,
		memberCode,
		partnerCode,
		memberAuthToken,
		onTextDelta,
		onTextEnd,
		logger,
	} = options;

	const syncOptions = { memberCode, partnerCode, memberAuthToken };

	const attempt = async () => {
		const sandbox = await sandboxManager.getOrCreateSandbox(userId, logger);
		const docsRoot = sandboxManager.getDocsRoot(userId);

		const ensured = await startInitialSyncIfNeeded({
			userId,
			sandbox,
			options: syncOptions,
			logger,
		});
		if (ensured.status !== "synced") {
			return { status: "syncing" } as const;
		}

		// Incremental sync — inline, blocking, every request
		await runIncrementalSync({
			userId,
			sandbox,
			options: syncOptions,
			logger,
		});

		// Proceed with agent
		const sessionId = sessionStore.getSessionId(chatKey, userId);

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

		return { status: "completed" } as const;
	};

	try {
		return await attempt();
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

		try {
			return await attempt();
		} catch (retryErr) {
			logger.error({
				msg: "Sandbox creation retry also failed",
				userId,
				error: retryErr instanceof Error ? retryErr.message : String(retryErr),
			});
			throw retryErr;
		}
	}
}
