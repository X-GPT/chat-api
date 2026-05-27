import { mintLlmToken } from "@mymemo/llm-token";
import { apiEnv, type ChatMessagesScope } from "@/config/env";
import type { ChatLogger } from "@/features/chat/chat.logger";
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

export function sanitizePathSegment(value: string): string {
	return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "unknown";
}

export interface RunSandboxChatOptions {
	userId: string;
	query: string;
	scope: ChatMessagesScope;
	collectionId: string | null;
	summaryId: string | null;
	sessionId: string | null;
	sandboxId: string | null;
	onTextDelta: (text: string) => Promise<void>;
	onTextEnd: () => Promise<void>;
	onSessionId: (sessionId: string) => Promise<void>;
	onSandboxId: (sandboxId: string) => Promise<void>;
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
		sessionId,
		sandboxId,
		onTextDelta,
		onTextEnd,
		onSessionId,
		onSandboxId,
		logger,
	} = options;

	// Note: user_files is populated by an external service. The daemon's
	// reconcile() diffs user_files against its local .sync-manifest.json
	// on each turn to sync documents into the sandbox filesystem.

	const attempt = async () => {
		const sandbox = await sandboxManager.getOrCreateSandbox(
			userId,
			sandboxId,
			logger,
		);

		await onSandboxId(sandbox.sandboxId);

		const daemon = await sandboxManager.ensureSandboxDaemon(
			userId,
			sandbox,
			logger,
		);

		const docsRoot = `/workspace/data/${sanitizePathSegment(userId)}`;
		const systemPrompt = buildSandboxAgentPrompt({
			scope,
			summaryId,
			collectionId,
			docsRoot,
			conversationContext: null,
		});

		const requestId = crypto.randomUUID();
		const turnRequest: TurnRequest = {
			request_id: requestId,
			user_id: userId,
			scope_type: toSandboxScope(scope),
			collection_id: collectionId ?? undefined,
			summary_id: summaryId ?? undefined,
			message: query,
			agent_session_id: sessionId ?? undefined,
			system_prompt: systemPrompt,
			llm_base_url: apiEnv.LLM_GATEWAY_PUBLIC_URL,
			llm_token: mintLlmToken(
				{ userId, sandboxId: sandbox.sandboxId, requestId },
				apiEnv.LLM_TOKEN_SECRET,
			),
		};

		await forwardChatTurnToSandbox({
			daemonUrl: daemon.url,
			daemonAuthToken: daemon.authToken,
			turnRequest,
			onTextDelta,
			onTextEnd,
			onSessionId,
		});

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
