import { tool } from "ai";
import { z } from "zod";
import type { EventMessage } from "../chat.events";

export const answerWithCitationsTool = tool({
	description:
		"Once you've received the answer from all the tool uses and can confirm that the task is complete, " +
		"use this tool to present the result of your work to the user with the provided answer and cited summary ids.",
	inputSchema: z.object({
		answer: z.string().describe("The final answer to the question."),
		citedSummaryIds: z
			.array(z.string())
			.describe(
				"The ids of the summaries that were used to answer the question.",
			),
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
