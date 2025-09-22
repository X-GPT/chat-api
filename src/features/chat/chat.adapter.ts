import type { ModelMessage } from "ai";
import invariant from "tiny-invariant";
import type { ProtectedChatMessage } from "./chat.external";

const USER_SENDER_TYPE = "user";
const TEXT_TYPE = "text";

type SupportedRole = "user" | "assistant";

interface AdapterMessage {
	role: SupportedRole;
	text: string;
}

function getRoleFromSenderType(
	senderType: string | null | undefined,
): SupportedRole {
	if (!senderType) {
		return "assistant";
	}

	const normalized = senderType.trim().toLowerCase();
	if (normalized === USER_SENDER_TYPE) {
		return "user";
	}

	return "assistant";
}

function isNonEmptyContent(value: string | null | undefined): value is string {
	return Boolean(value && value.trim().length > 0);
}

function enforceAlternatingRoles(messages: AdapterMessage[]): AdapterMessage[] {
	const validated: AdapterMessage[] = [];
	let previousRole: SupportedRole | null = null;

	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		invariant(message, "message is guaranteed to be non-null");

		if (previousRole === null) {
			validated.push(message);
			previousRole = message.role;
			continue;
		}

		if (message.role === previousRole) {
			break;
		}

		validated.push(message);
		previousRole = message.role;
	}

	// Reverse the array to process messages in the correct order, from oldest to newest.
	const result = validated.reverse();

	// If the first message is 'assistant', remove it.
	// This ensures that the message sequence always starts with a user message,
	// which is required by the downstream model. An assistant message at the beginning may
	// indicate an incomplete or invalid conversation history, so we remove them to
	// maintain a valid alternating message flow.
	if (result[0]?.role === "assistant") {
		result.shift();
	}

	// If the last message is 'user', remove it.
	// This ensures that the message sequence always ends with an assistant message,
	// which is required by the downstream model. A user message at the end may
	// indicate an incomplete or invalid conversation history, so we remove them to
	// maintain a valid alternating message flow.
	if (result[result.length - 1]?.role === "user") {
		result.pop();
	}

	return result;
}

function toModelMessage(message: AdapterMessage): ModelMessage {
	return {
		role: message.role,
		content: [{ type: TEXT_TYPE, text: message.text }],
	};
}

export function adaptProtectedMessagesToModelMessages(
	messages: ProtectedChatMessage[],
): ModelMessage[] {
	const adapterMessages = messages
		.filter((message) => isNonEmptyContent(message.chatContent))
		.map((message) => {
			invariant(message.chatContent, "chatContent is required");
			return {
				role: getRoleFromSenderType(message.senderType),
				text: message.chatContent.trim(),
			} satisfies AdapterMessage;
		});

	const alternatingMessages = enforceAlternatingRoles(adapterMessages);

	return alternatingMessages.map((message) => toModelMessage(message));
}
