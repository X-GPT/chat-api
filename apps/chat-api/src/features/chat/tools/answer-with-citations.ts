import { tool } from "ai";
import { z } from "zod";
import type { EventMessage } from "../chat.events";

export const answerWithCitationsTool = tool({
	description: "Answer a question with citations",
	inputSchema: z.object({
		answer: z.string(),
		citedSummaryIds: z.array(z.string()),
	}),
});

export async function handleAnswerWithCitations({
	onEvent,
}: {
	onEvent: (event: EventMessage) => void;
}) {
	onEvent({
		type: "answer_with_citations",
		message: "Answer with citations",
	});
}
