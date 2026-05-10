import { describe, expect, it } from "bun:test";
import { adaptHistoryToModelMessages } from "./chat.adapter";
import type { ChatHistoryMessage } from "./chat.schema";

const buildMessage = (
	role: "user" | "assistant",
	content: string,
): ChatHistoryMessage => ({ role, content });

describe("adaptHistoryToModelMessages", () => {
	it("returns alternating messages with trimmed content", () => {
		const history: ChatHistoryMessage[] = [
			buildMessage("user", " Hello "),
			buildMessage("assistant", "  "),
			buildMessage("user", ""),
			buildMessage("assistant", "Thanks for reaching out"),
		];

		const result = adaptHistoryToModelMessages(history);

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

	it("removes an unmatched trailing user message", () => {
		const history: ChatHistoryMessage[] = [
			buildMessage("user", "First user"),
			buildMessage("assistant", "Assistant reply"),
			buildMessage("user", "Latest user"),
		];

		const result = adaptHistoryToModelMessages(history);

		expect(result).toEqual([
			{
				role: "user",
				content: [{ type: "text", text: "First user" }],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "Assistant reply" }],
			},
		]);
	});

	it("keeps only the most recent alternating user/assistant pair", () => {
		const history: ChatHistoryMessage[] = [
			buildMessage("user", "First user"),
			buildMessage("assistant", "Assistant one"),
			buildMessage("assistant", "Assistant two"),
			buildMessage("user", "Latest user"),
			buildMessage("assistant", "Latest assistant"),
		];

		const result = adaptHistoryToModelMessages(history);

		expect(result).toEqual([
			{
				role: "user",
				content: [{ type: "text", text: "Latest user" }],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "Latest assistant" }],
			},
		]);
	});

	it("returns an empty array when trailing assistant replies have no matching user", () => {
		const history: ChatHistoryMessage[] = [
			buildMessage("assistant", "Assistant only"),
		];

		const result = adaptHistoryToModelMessages(history);

		expect(result).toEqual([]);
	});
});
