import type { ModelMessage } from "ai";
import type { ProtectedChatMessage } from "./chat.external";

const USER_SENDER_TYPE = "user";

const TEXT_TYPE = "text";

function getRoleFromSenderType(senderType: string | null | undefined): "user" | "assistant" {
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

export function adaptProtectedMessagesToModelMessages(
	messages: ProtectedChatMessage[],
): ModelMessage[] {
	return messages
		.filter((message) => isNonEmptyContent(message.chatContent))
		.map((message) => {
			const role = getRoleFromSenderType(message.senderType);
			const content = [
				{ type: TEXT_TYPE as const, text: message.chatContent! },
			] as const;

			if (role === "user") {
				return {
					role,
					content,
				} as ModelMessage;
			}

			return {
				role,
				content,
			} as ModelMessage;
		});
}
