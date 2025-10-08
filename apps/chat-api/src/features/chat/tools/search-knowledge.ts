import { tool } from "ai";
import { z } from "zod";
import { getRagSearchEndpoint } from "@/config/env";
import type { EventMessage } from "../chat.events";
import type { ChatLogger } from "../chat.logger";

// Tool definition for the LLM
export const searchKnowledgeTool = tool({
	description:
		"Search through ingested documents using hybrid semantic and keyword search. Use this to find relevant information from the user's knowledge base.",
	inputSchema: z.object({
		query: z
			.string()
			.describe("The search query to find relevant information"),
	}),
});

interface SearchRequest {
	query: string;
	member_code?: string | null;
	summary_id?: number | null;
	limit?: number;
	sparse_top_k?: number;
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
	logger,
	onEvent,
}: {
	query: string;
	memberCode: string | null;
	summaryId: string | null;
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
		};

		logger.info({
			message: "Searching knowledge base",
			query,
			memberCode,
			summaryId,
			endpoint,
		});

		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(requestBody),
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "Unknown error");
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
		const errorMessage =
			error instanceof Error ? error.message : String(error);
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
		return `
<searchResults>
	<query>${escapeXml(data.query)}</query>
	<totalResults>0</totalResults>
	<message>No results found for this query.</message>
</searchResults>
		`.trim();
	}

	const summariesXml = Object.entries(data.results)
		.map(([summaryKey, summary]) => {
			const chunksXml = summary.chunks
				.map((chunk) => {
					const childrenXml = chunk.matching_children
						.map(
							(child) => `
				<matchingChild>
					<chunkIndex>${child.chunk_index}</chunkIndex>
					<score>${child.score.toFixed(4)}</score>
					<text>${escapeXml(child.text)}</text>
				</matchingChild>`,
						)
						.join("");

					return `
			<chunk>
				<chunkIndex>${chunk.chunk_index}</chunkIndex>
				<maxScore>${chunk.max_score.toFixed(4)}</maxScore>
				<text>${escapeXml(chunk.text)}</text>
				<matchingChildren>${childrenXml}
				</matchingChildren>
			</chunk>`;
				})
				.join("");

			return `
		<summary>
			<summaryId>${summary.summary_id}</summaryId>
			<memberCode>${escapeXml(summary.member_code)}</memberCode>
			<maxScore>${summary.max_score.toFixed(4)}</maxScore>
			<totalChunks>${summary.total_chunks}</totalChunks>
			<chunks>${chunksXml}
			</chunks>
		</summary>`;
		})
		.join("");

	return `
<searchResults>
	<query>${escapeXml(data.query)}</query>
	<totalResults>${data.total_results}</totalResults>
	<summaries>${summariesXml}
	</summaries>
</searchResults>
	`.trim();
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
