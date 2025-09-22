import { describe, expect, it } from "bun:test";
import { adaptProtectedMessagesToModelMessages } from "./chat.adapter";
import type { ProtectedChatMessage } from "./chat.external";

const buildMessage = (
	chatContent: string | null,
	senderType: string | null | undefined,
): ProtectedChatMessage => ({
	chatContent,
	senderType,
} as ProtectedChatMessage);

describe("adaptProtectedMessagesToModelMessages", () => {
	it("returns alternating messages with trimmed content", () => {
		const history: ProtectedChatMessage[] = [
			buildMessage(" Hello ", "User"),
			buildMessage("  ", "assistant"),
			buildMessage(null, "user"),
			buildMessage("Thanks for reaching out", "assistant"),
		];

		const result = adaptProtectedMessagesToModelMessages(history);

		expect(result).toEqual([
			{
				role: "user",
				content: [{ type: "text", text: "Hello" }],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "Thanks for reaching out" }],
			},
		]);
	});

	it("drops earlier history after consecutive messages from the same role", () => {
		const history: ProtectedChatMessage[] = [
			buildMessage("First user", "user"),
			buildMessage("Assistant one", "assistant"),
			buildMessage("Assistant two", "assistant"),
			buildMessage("Latest user", "user"),
		];

		const result = adaptProtectedMessagesToModelMessages(history);

		expect(result).toEqual([
			{
				role: "user",
				content: [{ type: "text", text: "Latest user" }],
			},
		]);
	});

	it("returns an empty array when trailing assistant replies have no matching user", () => {
		const history: ProtectedChatMessage[] = [
			buildMessage("Assistant only", "assistant"),
		];

		const result = adaptProtectedMessagesToModelMessages(history);

		expect(result).toEqual([]);
	});
});
