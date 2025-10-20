import { tool } from "ai";
import { z } from "zod";
import { getRagSearchEndpoint } from "@/config/env";
import type { EventMessage } from "../chat.events";
import type { ChatLogger } from "../chat.logger";
import { xml } from "./utils";

// Tool definition for the LLM
export const searchKnowledgeTool = tool({
	description:
		"Search through ingested documents using hybrid semantic and keyword search. Use this to find relevant information from the user's knowledge base.",
	inputSchema: z.object({
		query: z.string().describe("The search query to find relevant information"),
	}),
});

interface SearchRequest {
	query: string;
	member_code?: string | null;
	summary_id?: number | null;
	limit?: number;
	sparse_top_k?: number;
	collection_id?: string | null;
}

interface MatchingChild {
	id: string;
	text: string;
	score: number;
	chunk_index: number;
}

interface SearchResultItem {
	id: string;
	text: string;
	max_score: number;
	chunk_index: number;
	matching_children: MatchingChild[];
}

interface SummaryResults {
	summary_id: number;
	member_code: string;
	chunks: SearchResultItem[];
	total_chunks: number;
	max_score: number;
}

interface SearchResponse {
	query: string;
	results: Record<string, SummaryResults>;
	total_results: number;
}

export async function handleSearchKnowledge({
	query,
	memberCode,
	summaryId,
	collectionId,
	logger,
	onEvent,
}: {
	query: string;
	memberCode: string;
	summaryId: string | null;
	collectionId: string | null;
	logger: ChatLogger;
	onEvent: (event: EventMessage) => void;
}): Promise<string> {
	onEvent({
		type: "search_knowledge.started",
		query,
	});

	try {
		const endpoint = getRagSearchEndpoint();

		const requestBody: SearchRequest = {
			query,
			member_code: memberCode,
			summary_id: summaryId ? Number.parseInt(summaryId, 10) : null,
			limit: 10,
			sparse_top_k: 10,
			collection_id: collectionId,
		};

		logger.info({
			message: "Searching knowledge base",
			query,
			memberCode,
			summaryId,
			endpoint,
			collectionId,
		});

		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(requestBody),
		});

		if (!response.ok) {
			const errorText = await response
				.text()
				.catch(
					() => `Failed to read error response (status: ${response.status})`,
				);
			logger.error({
				message: "RAG search request failed",
				status: response.status,
				error: errorText,
			});
			throw new Error(`Search failed: ${response.status} - ${errorText}`);
		}

		const data = (await response.json()) as SearchResponse;

		logger.info({
			message: "Search completed",
			totalResults: data.total_results,
			summariesCount: Object.keys(data.results).length,
		});

		onEvent({
			type: "search_knowledge.completed",
			query,
			totalResults: data.total_results,
		});

		// Format results as XML
		return formatSearchResults(data);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error({
			message: "Error during knowledge search",
			error: errorMessage,
			query,
		});

		onEvent({
			type: "search_knowledge.completed",
			query,
			totalResults: 0,
			error: errorMessage,
		});

		throw new Error(`Knowledge search failed: ${errorMessage}`);
	}
}

function formatSearchResults(data: SearchResponse): string {
	if (data.total_results === 0) {
		return xml("searchResults", [
			xml("query", data.query, { indent: 1 }),
			xml("totalResults", 0, { indent: 1 }),
			xml("message", "No results found for this query.", { indent: 1 }),
		]);
	}

	const summaries = Object.entries(data.results).map(
		([_summaryKey, summary]) => {
			const chunks = summary.chunks.map((chunk) => {
				const children = chunk.matching_children.map((child) =>
					xml(
						"matchingChild",
						[
							xml("chunkIndex", child.chunk_index, { indent: 4 }),
							xml("score", child.score.toFixed(4), { indent: 4 }),
							xml("text", child.text, { indent: 4 }),
						],
						{ indent: 3 },
					),
				);

				return xml(
					"chunk",
					[
						xml("chunkIndex", chunk.chunk_index, { indent: 3 }),
						xml("maxScore", chunk.max_score.toFixed(4), { indent: 3 }),
						xml("text", chunk.text, { indent: 3 }),
						xml("matchingChildren", children, { indent: 3 }),
					],
					{ indent: 2 },
				);
			});

			return xml(
				"summary",
				[
					xml("summaryId", summary.summary_id, { indent: 2 }),
					xml("memberCode", summary.member_code, { indent: 2 }),
					xml("maxScore", summary.max_score.toFixed(4), { indent: 2 }),
					xml("totalChunks", summary.total_chunks, { indent: 2 }),
					xml("chunks", chunks, { indent: 2 }),
				],
				{ indent: 1 },
			);
		},
	);

	return xml("searchResults", [
		xml("query", data.query, { indent: 1 }),
		xml("totalResults", data.total_results, { indent: 1 }),
		xml("summaries", summaries, { indent: 1 }),
	]);
}
