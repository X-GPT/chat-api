import type { ModelMessage } from "ai";
import invariant from "tiny-invariant";
import type { ChatHistoryMessage } from "./chat.schema";

type SupportedRole = "user" | "assistant";

interface AdapterMessage {
	role: SupportedRole;
	text: string;
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

	const result = validated.reverse();

	if (result[0]?.role !== "user") {
		result.shift();
	}

	if (result[result.length - 1]?.role !== "assistant") {
		result.pop();
	}

	return result;
}

function toModelMessage(message: AdapterMessage): ModelMessage {
	return {
		role: message.role,
		content: [{ type: "text", text: message.text }],
	};
}

export function adaptHistoryToModelMessages(
	messages: ChatHistoryMessage[],
): ModelMessage[] {
	const adapterMessages = messages
		.filter((message) => isNonEmptyContent(message.content))
		.map((message) => ({
			role: message.role,
			text: message.content.trim(),
		}));

	const alternatingMessages = enforceAlternatingRoles(adapterMessages);

	return alternatingMessages.map(toModelMessage);
}
