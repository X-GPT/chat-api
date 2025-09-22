import type { ModelMessage } from "ai";
import invariant from "tiny-invariant";
import type { ProtectedChatMessage } from "./chat.external";

const USER_SENDER_TYPE = "user";

const TEXT_TYPE = "text";

function getRoleFromSenderType(
	senderType: string | null | undefined,
): "user" | "assistant" {
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
			invariant(
				message.chatContent,
				"chatContent is required for convert ImChatVO to ModelMessage",
			);
			const role = getRoleFromSenderType(message.senderType);
			const content = [{ type: TEXT_TYPE, text: message.chatContent }];

			if (role === "user") {
				return {
					role: "user" as const,
					content,
				} as ModelMessage;
			}

			return {
				role: "assistant" as const,
				content,
			} as ModelMessage;
		});
}
