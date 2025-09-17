import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

export async function complete(messages: UIMessage[]) {
	const result = streamText({
		model: openai("gpt-4o"),
		system: "You are a helpful assistant.",
		messages: convertToModelMessages(messages),
	});

	return result.toUIMessageStreamResponse();
}
