import { tool } from "ai";
import { z } from "zod";
import type { FetchOptions } from "../api/client";
import { fetchProtectedMemberSummaries } from "../api/summaries";
import type { EventMessage } from "../chat.events";
import type { ChatLogger } from "../chat.logger";
import {
	type RankedDocument,
	rankDocumentsByRelevance,
} from "../lib/ai-document-ranker";
import { xml } from "./utils";

// Tool definition for the LLM
export const searchDocumentsTool = tool({
	description:
		"Search for the most relevant documents by AI-analyzing document summaries. Use this when you need to find documents related to a specific topic or query across the user's knowledge base. This tool uses AI to rank documents by relevance and returns the most pertinent ones.",
	inputSchema: z.object({
		query: z
			.string()
			.describe(
				"The search query describing what documents you're looking for",
			),
	}),
});

export async function handleSearchDocuments({
	query,
	memberCode,
	partnerCode,
	collectionId,
	protectedFetchOptions,
	logger,
	onEvent,
}: {
	query: string;
	memberCode: string;
	partnerCode: string;
	collectionId: string | null;
	protectedFetchOptions: FetchOptions;
	logger: ChatLogger;
	onEvent: (event: EventMessage) => void;
}): Promise<string> {
	onEvent({
		type: "search_documents.started",
		query,
	});

	try {
		logger.info({
			message: "Starting document search",
			query,
			memberCode,
			partnerCode,
			collectionId,
		});

		// Fetch first page to determine total pages
		const pageSize = 50; // Balance between API calls and processing
		const firstPage = await fetchProtectedMemberSummaries(
			memberCode,
			{
				partnerCode,
				collectionId: collectionId ? Number(collectionId) : null,
				pageIndex: 1,
				pageSize,
			},
			protectedFetchOptions,
			logger,
		);

		const totalPages = firstPage.totalPages;
		const totalRecords = firstPage.total;

		logger.info({
			message: "First page fetched",
			totalPages,
			totalRecords,
			firstPageRecords: firstPage.list.length,
			ids: firstPage.list.map((doc) => doc.id),
		});

		// Handle empty results
		if (totalRecords === 0) {
			logger.info({
				message: "No documents found",
				query,
			});

			onEvent({
				type: "search_documents.completed",
				query,
				totalDocuments: 0,
			});

			return xml("searchResults", [
				xml("query", query, { indent: 1 }),
				xml("totalDocuments", 0, { indent: 1 }),
				xml("message", "No documents found in the knowledge base.", {
					indent: 1,
				}),
			]);
		}

		// Collect all ranked documents from all pages
		const allRankedDocuments: RankedDocument[] = [];

		// Process first page
		const firstPageRanking = await rankDocumentsByRelevance({
			query,
			summaries: firstPage.list,
			topK: 10,
			logger,
		});
		allRankedDocuments.push(...firstPageRanking.rankedDocuments);

		logger.info({
			message: "First page ranked",
			rankedCount: firstPageRanking.rankedDocuments.length,
		});

		// Process remaining pages
		if (totalPages > 1) {
			const remainingPages = Array.from(
				{ length: totalPages - 1 },
				(_, i) => i + 2,
			);

			logger.info({
				message: "Processing remaining pages",
				remainingPagesCount: remainingPages.length,
			});

			// Process pages in parallel for better performance
			const pageRankings = await Promise.all(
				remainingPages.map(async (pageIndex) => {
					try {
						const page = await fetchProtectedMemberSummaries(
							memberCode,
							{
								partnerCode,
								collectionId: collectionId ? Number(collectionId) : null,
								pageIndex,
								pageSize,
							},
							protectedFetchOptions,
							logger,
						);

						if (page.list.length === 0) {
							return { rankedDocuments: [], totalProcessed: 0 };
						}

						return await rankDocumentsByRelevance({
							query,
							summaries: page.list,
							topK: 10,
							logger,
						});
					} catch (error) {
						logger.error({
							message: "Error processing page",
							pageIndex,
							error: error instanceof Error ? error.message : String(error),
						});
						return { rankedDocuments: [], totalProcessed: 0 };
					}
				}),
			);

			// Aggregate results from all pages
			for (const ranking of pageRankings) {
				allRankedDocuments.push(...ranking.rankedDocuments);
			}

			logger.info({
				message: "All pages processed",
				totalRankedDocuments: allRankedDocuments.length,
			});
		}

		// Deduplicate and re-rank to get final top 20
		const uniqueDocuments = new Map<string, RankedDocument>();
		for (const doc of allRankedDocuments) {
			const docId = String(doc.id);
			const existing = uniqueDocuments.get(docId);
			// Keep the highest relevance score if duplicate
			if (!existing || doc.relevanceScore > existing.relevanceScore) {
				uniqueDocuments.set(docId, doc);
			}
		}

		// Sort by relevance and take top 20
		const finalDocuments = Array.from(uniqueDocuments.values())
			.sort((a, b) => b.relevanceScore - a.relevanceScore)
			.slice(0, 20);

		logger.info({
			message: "Document search completed",
			totalDocumentsFound: finalDocuments.length,
			topScore: finalDocuments[0]?.relevanceScore,
		});

		onEvent({
			type: "search_documents.completed",
			query,
			totalDocuments: finalDocuments.length,
		});

		// Format results as XML
		return formatSearchResults(query, finalDocuments);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error({
			message: "Error during document search",
			error: errorMessage,
			query,
		});

		onEvent({
			type: "search_documents.completed",
			query,
			totalDocuments: 0,
			error: errorMessage,
		});

		throw new Error(`Document search failed: ${errorMessage}`);
	}
}

function formatSearchResults(
	query: string,
	documents: RankedDocument[],
): string {
	if (documents.length === 0) {
		return xml("searchResults", [
			xml("query", query, { indent: 1 }),
			xml("totalDocuments", 0, { indent: 1 }),
			xml("message", "No relevant documents found for this query.", {
				indent: 1,
			}),
		]);
	}

	const documentElements = documents.map((doc) =>
		xml(
			"document",
			[
				xml("id", String(doc.id), { indent: 3 }),
				xml("title", doc.title || "Untitled", { indent: 3 }),
				xml("relevanceScore", doc.relevanceScore.toFixed(4), { indent: 3 }),
			],
			{ indent: 2 },
		),
	);

	return xml("searchResults", [
		xml("query", query, { indent: 1 }),
		xml("totalDocuments", documents.length, { indent: 1 }),
		xml("documentIds", documentElements, { indent: 1 }),
	]);
}
