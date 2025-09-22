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

	// if the last message is 'assistant', remove it
	if (validated[validated.length - 1]?.role === "assistant") {
		validated.pop();
	}

	return validated.reverse();
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
