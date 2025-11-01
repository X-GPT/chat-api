import { tool } from "ai";
import { z } from "zod";
import type { FetchOptions } from "../api/client";
import { fetchProtectedSummaries } from "../api/summaries";
import type { ProtectedSummary } from "../api/types";
import type { Citation, EventMessage } from "../chat.events";
import type { ChatLogger } from "../chat.logger";

export const citationSchema = z.object({
	marker: z
		.string()
		.regex(/^c\d+$/)
		.describe("Inline marker like c1, c2"),
	fileId: z.string().describe("The file id of the cited source"),
});

export const updateCitationsToolInputSchema = z.object({
	upserts: z
		.array(citationSchema)
		.default([])
		.describe("The list of citations to upsert"),
	final: z
		.boolean()
		.default(false)
		.describe("Whether this is the final update of the citations"),
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
	citation: UpdateCitationsToolInput["upserts"][number],
) {
	return {
		marker: citation.marker,
		fileId: citation.fileId,
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
	const citations = args.upserts.map(normalizeCitation);
	const fileIds = Array.from(
		new Set(
			citations
				.map((citation) => String(citation.fileId).trim())
				.filter((id) => id.length > 0),
		),
	);

	let summaries: ProtectedSummary[] = [];
	if (fileIds.length > 0) {
		summaries = await fetchProtectedSummaries(
			fileIds,
			protectedFetchOptions,
			logger,
		);
	}

	onCitationsUpdate(
		summaries.map((summary, index) => ({
			...summary,
			number: index + 1,
		})),
	);

	onEvent({
		type: "citations.updated",
		citations: summaries.map((summary, index) => ({
			id: summary.id,
			number: index + 1,
			fileId: summary.id,
		})),
	});

	return {
		message: "Citations updated",
	};
}
