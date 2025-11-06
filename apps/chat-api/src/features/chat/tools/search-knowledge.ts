import { tool } from "ai";
import { z } from "zod";
import { getRagSearchEndpoint } from "@/config/env";
import type { FetchOptions } from "../api/client";
import { parseJsonSafely } from "../api/json-parser";
import { fetchProtectedSummaries } from "../api/summaries";
import type { ProtectedSummary } from "../api/types";
import type { EventMessage } from "../chat.events";
import type { ChatLogger } from "../chat.logger";
import type { RequestCache } from "../core/cache";
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

interface SearchResultItem {
	id: string;
	text: string;
	max_score: number;
	chunk_index: number;
}

interface SummaryResults {
	summary_id: string;
	chunks: SearchResultItem[];
	max_score: number;
}

interface SearchResponse {
	query: string;
	results: Record<string, SummaryResults>;
	total_results: number;
}

interface EnrichedSearchResponse extends SearchResponse {
	results: Record<string, SummaryResults & { path: string }>;
}
export async function handleSearchKnowledge({
	query,
	memberCode,
	summaryId,
	collectionId,
	protectedFetchOptions,
	summaryCache,
	logger,
	onEvent,
}: {
	query: string;
	memberCode: string;
	summaryId: string | null;
	collectionId: string | null;
	protectedFetchOptions: FetchOptions;
	summaryCache: RequestCache<ProtectedSummary[]>;
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

		const data = (await parseJsonSafely(response)) as SearchResponse;

		const fileIds = new Set(
			Object.values(data.results).map((summary) => summary.summary_id),
		);

		// Fetch summaries with caching handled by fetchProtectedSummaries
		const summaries = await fetchProtectedSummaries(
			Array.from(fileIds),
			protectedFetchOptions,
			logger,
			summaryCache,
		);

		const enrichedResults: Record<string, SummaryResults & { path: string }> =
			Object.fromEntries(
				Object.entries(data.results).map(([summaryId, result]) => {
					const summary = summaries.find(
						(summary) => summary.id === String(summaryId),
					);
					const path =
						summary?.type === 3
							? `notes/3/${summaryId}`
							: `detail/${summary?.type ?? 0}/${summaryId}`;
					return [summaryId, { ...result, path }];
				}),
			);

		const enrichedData: EnrichedSearchResponse = {
			...data,
			results: enrichedResults,
		};

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
		return formatSearchResults(enrichedData);
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

function formatSearchResults(data: EnrichedSearchResponse): string {
	if (data.total_results === 0) {
		return xml("searchResults", [
			xml("query", data.query, { indent: 1 }),
			xml("totalResults", 0, { indent: 1 }),
			xml("message", "No results found for this query.", { indent: 1 }),
		]);
	}

	const files = Object.entries(data.results).map(([_summaryKey, file]) => {
		const chunks = file.chunks.map((chunk) => {
			return xml(
				"chunk",
				[
					xml("maxScore", chunk.max_score.toFixed(4), { indent: 3 }),
					xml("text", chunk.text, { indent: 3 }),
				],
				{ indent: 2 },
			);
		});

		return xml(
			"file",
			[
				xml("fileId", file.summary_id, { indent: 2 }),
				xml("path", file.path, { indent: 2 }),
				xml("maxScore", file.max_score.toFixed(4), { indent: 2 }),
				xml("chunks", chunks, { indent: 2 }),
			],
			{ indent: 1 },
		);
	});

	return `${xml("searchResults", [
		xml("query", data.query, { indent: 1 }),
		xml("totalResults", data.total_results, { indent: 1 }),
		xml("files", files, { indent: 1 }),
	])}\n\n "You must use the text in the chunks in the search results to answer the question. If the information is not in the files, explicitly state: 'I cannot find this information in the available files.'"`;
}
