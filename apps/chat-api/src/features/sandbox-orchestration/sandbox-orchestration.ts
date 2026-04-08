import type { ChatMessagesScope } from "@/config/env";
import { getTurnContext } from "@/db/user-runtime";
import { getSessionId, upsertSessionId } from "@/db/user-sessions";
import type { ChatLogger } from "@/features/chat/chat.logger";
import { sanitizePathSegment } from "@/features/sandbox";
import { buildSandboxAgentPrompt } from "@/features/sandbox-agent";
import { SandboxCreationError } from "./errors";
import { forwardChatTurnToSandbox, type TurnRequest } from "./sandbox-proxy";
import { sandboxManager } from "./singleton";

type SandboxScopeType = "global" | "collection" | "document";

function toSandboxScope(scope: ChatMessagesScope): SandboxScopeType {
	if (scope === "collection") return "collection";
	if (scope === "document") return "document";
	return "global";
}

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

export type RunSandboxChatResult = { status: "completed" };

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
		onTextDelta,
		onTextEnd,
		logger,
	} = options;

	// Note: user_files table is populated by an external service.
	// The daemon's reconcile() reads from user_files to sync documents
	// to the sandbox filesystem. If user_files is empty, the agent will
	// see no documents.

	const attempt = async () => {
		// 1. Get sandbox + runtime state in parallel
		const [sandbox, { state_version }] = await Promise.all([
			sandboxManager.getOrCreateSandbox(userId, logger),
			getTurnContext(userId),
		]);

		// Read session AFTER sandbox is resolved — creation clears stale sessions
		const agentSessionId = await getSessionId(userId, chatKey);

		// 2. Ensure daemon is running (depends on sandbox)
		const daemonUrl = await sandboxManager.ensureSandboxDaemon(
			userId,
			sandbox,
			logger,
		);

		// 3. Build system prompt — path must match daemon's getDataRoot()
		const docsRoot = `/workspace/data/${sanitizePathSegment(userId)}`;
		const systemPrompt = buildSandboxAgentPrompt({
			scope,
			summaryId,
			collectionId,
			docsRoot,
			conversationContext: null,
		});

		// 4. Build turn request
		const turnRequest: TurnRequest = {
			request_id: crypto.randomUUID(),
			user_id: userId,
			required_version: state_version,
			scope_type: toSandboxScope(scope),
			collection_id: collectionId ?? undefined,
			summary_id: summaryId ?? undefined,
			message: query,
			agent_session_id: agentSessionId ?? undefined,
			system_prompt: systemPrompt,
		};

		// 5. Forward to daemon with streaming
		let newSessionId: string | null = null;

		await forwardChatTurnToSandbox({
			daemonUrl,
			turnRequest,
			onTextDelta,
			onTextEnd,
			onSessionId: (id) => {
				newSessionId = id;
			},
		});

		// 6. Persist session ID for this chat
		if (newSessionId) {
			await upsertSessionId(userId, chatKey, newSessionId);
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
