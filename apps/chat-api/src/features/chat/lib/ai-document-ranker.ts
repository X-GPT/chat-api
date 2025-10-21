import { type OpenAIResponsesProviderOptions, openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import z from "zod";
import type { ProtectedSummary } from "../api/types";
import type { ChatLogger } from "../chat.logger";

export interface RankedDocument {
	id: string | number;
	title: string | null;
	relevanceScore: number;
}

export interface RankDocumentsInput {
	query: string;
	summaries: ProtectedSummary[];
	topK?: number;
	logger: ChatLogger;
}

export interface RankDocumentsResult {
	rankedDocuments: RankedDocument[];
	totalProcessed: number;
}

/**
 * Internal utility to rank documents using AI based on relevance to a query.
 * This is NOT an LLM tool - it's a utility function used by the search-documents tool.
 *
 * Uses gpt-5-nano for efficient document ranking across paginated summaries.
 */
export async function rankDocumentsByRelevance({
	query,
	summaries,
	topK = 10,
	logger,
}: RankDocumentsInput): Promise<RankDocumentsResult> {
	// Handle empty summaries
	if (summaries.length === 0) {
		logger.info({
			message: "No summaries to rank",
			query,
		});
		return {
			rankedDocuments: [],
			totalProcessed: 0,
		};
	}

	try {
		// Prepare summaries data for AI analysis
		const summariesData = summaries.map((summary) => ({
			id: String(summary.id),
			title:
				summary.title || summary.summaryTitle || summary.fileName || "Untitled",
			content: summary.content || summary.parseContent || "",
			fileType: summary.fileType || "unknown",
		}));

		// Create the prompt for AI ranking
		const systemPrompt = `You are a relevance ranking assistant. Analyze document summaries and rank them by semantic relevance to the user's query.

Rules:
- Rank by semantic relevance to the query
- relevanceScore must be between 0.0 and 1.0
- Only include documents with some relevance (score > 0.3)
- Return up to ${topK} documents, ordered by relevance (highest first)`;

		const userPrompt = `Query: "${query}"

Analyze these ${summariesData.length} documents:

${summariesData
	.map(
		(doc, idx) => `
Document ${idx + 1}:
- ID: ${doc.id}
- Title: ${doc.title}
- Type: ${doc.fileType}
- Content: ${doc.content.slice(0, 800)}${doc.content.length > 800 ? "..." : ""}
`,
	)
	.join("\n")}`;

		logger.info({
			message: "Ranking documents with AI",
			query,
			summariesCount: summaries.length,
			topK,
			systemPrompt,
			userPrompt,
		});

		// Call AI model for ranking
		const result = await generateObject({
			model: openai("gpt-5-nano"),
			system: systemPrompt,
			prompt: userPrompt,
			maxOutputTokens: 2000,
			schema: z.object({
				rankedDocuments: z.array(
					z.object({
						id: z.string(),
						title: z.string(),
						relevanceScore: z.number(),
					}),
				),
			}),
			providerOptions: {
				openai: {
					reasoningEffort: "minimal",
				} satisfies OpenAIResponsesProviderOptions,
			},
		});

		logger.info({
			message: "AI ranking completed",
			responseLength: result.object.rankedDocuments.length,
			response: result.object,
		});

		// Filter and limit results (Zod schema already validates structure)
		const rankedDocuments = result.object.rankedDocuments
			.filter((doc) => doc.relevanceScore > 0.3)
			.slice(0, topK);

		logger.info({
			message: "Documents ranked successfully",
			rankedCount: rankedDocuments.length,
			topScore: rankedDocuments[0]?.relevanceScore,
		});

		return {
			rankedDocuments,
			totalProcessed: summaries.length,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error({
			message: "Error ranking documents with AI",
			error: errorMessage,
			query,
			summariesCount: summaries.length,
		});
		throw new Error(`AI document ranking failed: ${errorMessage}`);
	}
}
