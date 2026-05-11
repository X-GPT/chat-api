import type { ChatMessagesScope } from "@/config/env";
import { runSandboxChat } from "@/features/sandbox-orchestration";
import type { EventMessage } from "./chat.events";
import type { ChatLogger } from "./chat.logger";
import type { ChatRequest } from "./chat.schema";
import type { MymemoEventSender } from "./chat.streaming";

export async function complete(
	request: ChatRequest,
	mymemoEventSender: MymemoEventSender,
	logger: ChatLogger,
) {
	const { chatContent, collectionId, summaryId, sessionId, memberCode } =
		request;

	const normalizedCollectionId = collectionId?.trim() ?? null;
	const normalizedSummaryId = summaryId?.trim() ?? null;

	let scope: ChatMessagesScope = "general";
	if (normalizedSummaryId) {
		scope = "document";
	} else if (normalizedCollectionId) {
		scope = "collection";
	}

	const sendEvent = (message: EventMessage): Promise<void> =>
		mymemoEventSender.send({ id: crypto.randomUUID(), message });

	const onTextDelta = (text: string) => {
		// Fire-and-forget on the hot path; the final `done` event in onTextEnd
		// is awaited so the stream stays open until it flushes.
		sendEvent({ type: "text_delta", text }).catch((err) => {
			logger.error({
				message: "Failed to send text_delta",
				error: err,
			});
		});
	};

	const onTextEnd = async () => {
		await sendEvent({ type: "done" });
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
