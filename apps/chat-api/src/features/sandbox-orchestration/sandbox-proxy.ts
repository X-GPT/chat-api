import { ConversationBusyError } from "./errors";

export interface TurnRequest {
	request_id: string;
	user_id: string;
	scope_type: "global" | "collection" | "document";
	collection_id?: string;
	summary_id?: string;
	message: string;
	agent_session_id?: string;
	system_prompt: string;
}

interface ForwardOptions {
	daemonUrl: string;
	turnRequest: TurnRequest;
	onTextDelta: (text: string) => void;
	onTextEnd: () => Promise<void>;
	onSessionId: (id: string) => void;
}

/**
 * Forward a chat turn to the sandbox daemon via HTTP streaming.
 * Parses NDJSON response once per line and dispatches events.
 */
export async function forwardChatTurnToSandbox(
	options: ForwardOptions,
): Promise<void> {
	const { daemonUrl, turnRequest, onTextDelta, onTextEnd, onSessionId } =
		options;

	const response = await fetch(`${daemonUrl}/turn`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(turnRequest),
		signal: AbortSignal.timeout(120_000),
	});

	if (response.status === 409) {
		throw new ConversationBusyError("Sandbox is busy processing another turn");
	}

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`Daemon returned ${response.status}: ${text}`);
	}

	if (!response.body) {
		throw new Error("Daemon returned no response body");
	}

	let agentError: string | null = null;
	let buffer = "";

	const reader = response.body.getReader();
	const decoder = new TextDecoder();

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });

		let newlineIndex = buffer.indexOf("\n");
		while (newlineIndex !== -1) {
			const line = buffer.slice(0, newlineIndex).trim();
			buffer = buffer.slice(newlineIndex + 1);

			if (line) {
				try {
					const parsed = JSON.parse(line);
					if (typeof parsed === "object" && parsed !== null) {
						switch (parsed.type) {
							case "text_delta":
								if (typeof parsed.text === "string") {
									onTextDelta(parsed.text);
								}
								break;
							case "session_id":
								if (typeof parsed.sessionId === "string") {
									onSessionId(parsed.sessionId);
								}
								break;
							case "completed":
								break;
							case "failed":
								agentError = parsed.message ?? "Turn failed";
								break;
							case "started":
								break;
							case "result":
								break;
							case "error":
								agentError = parsed.message ?? "Unknown agent error";
								break;
						}
					}
				} catch {
					// Non-JSON line, ignore
				}
			}

			newlineIndex = buffer.indexOf("\n");
		}
	}

	// Flush remaining buffer
	if (buffer.trim()) {
		try {
			const parsed = JSON.parse(buffer.trim());
			if (parsed?.type === "failed")
				agentError = parsed.message ?? "Turn failed";
		} catch {
			// Ignore
		}
	}

	if (agentError) {
		throw new Error(`Sandbox agent error: ${agentError}`);
	}

	await onTextEnd();
}
