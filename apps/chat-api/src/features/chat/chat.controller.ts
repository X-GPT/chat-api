import type { ChatMessagesScope } from "@/config/env";
import { runSandboxChat } from "@/features/sandbox-orchestration";
import type { ChatEntity, EventMessage } from "./chat.events";
import type { ChatLogger } from "./chat.logger";
import type { ChatRequest } from "./chat.schema";
import type { MymemoEventSender } from "./chat.streaming";

export async function complete(
	request: ChatRequest,
	mymemoEventSender: MymemoEventSender,
	logger: ChatLogger,
) {
	const {
		chatContent,
		chatKey,
		chatType,
		collectionId,
		summaryId,
		sessionId,
		memberCode,
		memberName,
		teamCode,
		partnerCode,
		partnerName,
	} = request;

	const normalizedCollectionId = collectionId?.trim() ?? null;
	const normalizedSummaryId = summaryId?.trim() ?? null;

	const chatId = request.chatId ?? crypto.randomUUID();
	const refsId = request.refsId ?? crypto.randomUUID();

	let scope: ChatMessagesScope = "general";
	if (normalizedSummaryId) {
		scope = "document";
	} else if (normalizedCollectionId) {
		scope = "collection";
	}

	let accumulatedContent = "";

	const buildChatEntity = (readFlag: "0" | "1"): ChatEntity => ({
		id: chatId,
		chatKey,
		readFlag,
		delFlag: "0",
		teamCode: teamCode ?? null,
		memberCode,
		memberName: memberName ?? null,
		partnerCode,
		partnerName: partnerName ?? null,
		chatType,
		senderType: "AI",
		senderCode: partnerCode,
		chatContent: accumulatedContent,
		followup: "",
		endFlag: 1,
		collectionId: normalizedCollectionId,
		summaryId: normalizedSummaryId,
		refsId,
		collapseFlag: "1",
		refsContent: null,
	});

	const sendEvent = (message: EventMessage): Promise<void> =>
		mymemoEventSender.send({ id: crypto.randomUUID(), message });

	const sendChatEntity = (readFlag: "0" | "1"): Promise<void> =>
		sendEvent({ type: "chat_entity", ...buildChatEntity(readFlag) });

	const onTextDelta = (text: string) => {
		accumulatedContent += text;
		// Fire-and-forget on the hot path; the final entity in onTextEnd is
		// awaited so the stream stays open until it flushes.
		sendChatEntity("1").catch((err) => {
			logger.error({
				message: "Failed to send chat_entity delta",
				error: err,
			});
		});
	};

	const onTextEnd = async () => {
		await sendChatEntity("0");
	};

	const onSessionId = (newSessionId: string) => {
		// Skip echoing a sessionId the client already supplied.
		if (newSessionId === sessionId) return;
		sendEvent({ type: "session_id", sessionId: newSessionId }).catch((err) => {
			logger.error({
				message: "Failed to send session_id event",
				error: err,
			});
		});
	};

	await runSandboxChat({
		userId: memberCode,
		query: chatContent,
		scope,
		collectionId: normalizedCollectionId,
		summaryId: normalizedSummaryId,
		sessionId: sessionId ?? null,
		onTextDelta,
		onTextEnd,
		onSessionId,
		logger,
	});
}
