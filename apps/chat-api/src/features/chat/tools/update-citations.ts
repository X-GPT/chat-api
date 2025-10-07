import { tool } from "ai";
import { z } from "zod";
import type { Citation, EventMessage } from "../chat.events";
import {
	type FetchOptions,
	fetchProtectedSummaries,
	type ProtectedSummary,
} from "../chat.external";
import type { ChatLogger } from "../chat.logger";

export const citationSchema = z.object({
	id: z
		.string()
		.min(1, "Citation id cannot be empty")
		.describe("Identifier for the cited source (e.g. fileId)"),
	number: z
		.number()
		.int("Citation number must be an integer")
		.min(1, "Citation number must be positive")
		.describe("Numeric marker matching the [n] reference in the answer"),
});

export const updateCitationsToolInputSchema = z.object({
	citations: z
		.array(citationSchema)
		.describe("Ordered list of citations referenced in the assistant response"),
});

export type UpdateCitationsToolInput = z.infer<
	typeof updateCitationsToolInputSchema
>;

export const updateCitationsTool = tool({
	description:
		"Update the citations that support the current response. Provide fileIds with the numeric markers used in the answer, ordered by appearance.",
	inputSchema: updateCitationsToolInputSchema,
});

export function normalizeCitation(
	citation: UpdateCitationsToolInput["citations"][number],
) {
	return {
		id: citation.id,
		number: citation.number,
	};
}

export async function handleUpdateCitations({
	args,
	protectedFetchOptions,
	logger,
	onEvent,
	onCitationsUpdate,
}: {
	args: UpdateCitationsToolInput;
	protectedFetchOptions: FetchOptions;
	logger: ChatLogger;
	onEvent: (event: EventMessage) => void;
	onCitationsUpdate: (citations: Citation[]) => void;
}) {
	const citations = args.citations.map(normalizeCitation);
	const summaryIds = Array.from(
		new Set(
			citations
				.map((citation) => String(citation.id).trim())
				.filter((id) => id.length > 0),
		),
	);

	let summaries: ProtectedSummary[] = [];
	if (summaryIds.length > 0) {
		summaries = await fetchProtectedSummaries(
			summaryIds,
			protectedFetchOptions,
			logger,
		);
	}

	onCitationsUpdate(
		summaries.map((summary) => ({
			...summary,
			number:
				citations.find((citation) => citation.id === summary.id)?.number ?? 0,
		})),
	);

	onEvent({
		type: "citations.updated",
		citations: summaries.map((summary) => ({
			...summary,
			number:
				citations.find((citation) => citation.id === summary.id)?.number ?? 0,
		})),
	});

	return {
		message: "Citations updated",
	};
}
