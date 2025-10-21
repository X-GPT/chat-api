import { openai } from "@ai-sdk/openai";
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
		const systemPrompt = `You are a relevance ranking assistant. Your task is to analyze document summaries and identify the most relevant ones based on a user's query.

Return your response as a JSON array of objects with this structure:
[
  {"id": "document_id", "title": "document_title", "relevanceScore": 0.95},
  ...
]

Rules:
- Rank by semantic relevance to the query
- relevanceScore should be between 0.0 and 1.0
- Return up to ${topK} most relevant documents
- Only include documents that have some relevance (score > 0.3)
- Order by relevance score (highest first)`;

		const userPrompt = `Query: "${query}"

Analyze these ${summariesData.length} document summaries and return the IDs of the most relevant documents:

${summariesData
	.map(
		(doc, idx) => `
Document ${idx + 1}:
- ID: ${doc.id}
- Title: ${doc.title}
- Type: ${doc.fileType}
- Content Preview: ${doc.content.slice(0, 500)}${doc.content.length > 500 ? "..." : ""}
`,
	)
	.join("\n")}

Return ONLY the JSON array, no additional text.`;

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
			schema: z.array(
				z.object({
					id: z.string(),
					title: z.string(),
					relevanceScore: z.number(),
				}),
			),
		});

		logger.info({
			message: "AI ranking completed",
			responseLength: result.object.length,
			response: result.object,
		});

		// Parse the JSON response
		let rankedDocuments: RankedDocument[];
		try {
			rankedDocuments = result.object;

			// Validate the structure
			if (!Array.isArray(rankedDocuments)) {
				throw new Error("Response is not an array");
			}

			// Ensure all entries have required fields
			rankedDocuments = rankedDocuments
				.filter((doc) => {
					return (
						typeof doc === "object" &&
						doc !== null &&
						"id" in doc &&
						"relevanceScore" in doc &&
						typeof doc.relevanceScore === "number" &&
						doc.relevanceScore > 0.3 && // Filter low relevance
						doc.relevanceScore <= 1.0
					);
				})
				.map((doc) => ({
					id: String(doc.id),
					title: doc.title || null,
					relevanceScore: doc.relevanceScore,
				}))
				.slice(0, topK); // Ensure we only return topK documents
		} catch (parseError) {
			logger.error({
				message: "Failed to parse AI ranking response",
				error:
					parseError instanceof Error ? parseError.message : String(parseError),
				response: result.object,
			});
			throw new Error("Failed to parse AI ranking response");
		}

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
