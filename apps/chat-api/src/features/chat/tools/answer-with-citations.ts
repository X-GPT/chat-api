import { tool } from "ai";
import { z } from "zod";
import type { EventMessage } from "../chat.events";

export const answerWithCitationsTool = tool({
	description:
		"Answer a question with the provided answer and cited summary ids. The answer should be the final answer to the question and the cited summary ids should be the ids of the summaries that were used to answer the question.",
	inputSchema: z.object({
		answer: z.string(),
		citedSummaryIds: z.array(z.string()),
	}),
});

export async function handleAnswerWithCitations({
	answer,
	citedSummaryIds,
	onEvent,
}: {
	answer: string;
	citedSummaryIds: string[];
	onEvent: (event: EventMessage) => void;
}) {
	onEvent({
		type: "answer_with_citations",
		answer,
		citedSummaryIds,
	});
}
