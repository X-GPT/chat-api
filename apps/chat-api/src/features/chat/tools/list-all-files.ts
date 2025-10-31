import { tool } from "ai";
import { z } from "zod";
import type { FetchOptions } from "../api/client";
import { fetchProtectedFiles } from "../api/files";
import type { EventMessage } from "../chat.events";
import type { ChatLogger } from "../chat.logger";
import { normalizeFiles, xml } from "./utils";

/**
 * Sanitizes text for use in markdown table cells by escaping special characters
 * that could break table formatting (pipes, newlines, etc.).
 */
function sanitizeMarkdownTableCell(text: string): string {
	if (!text) {
		return "";
	}

	return text
		.replace(/\|/g, "\\|") // Escape pipe characters
		.replace(/\n/g, " ") // Replace newlines with spaces
		.replace(/\r/g, "") // Remove carriage returns
		.trim();
}

/**
 * Truncates text to a specified number of word tokens (split by whitespace).
 * Appends ellipsis if the original text was longer.
 */
function truncateToWordTokens(text: string, maxTokens: number): string {
	if (!text || text.trim() === "") {
		return "";
	}

	const words = text.trim().split(/\s+/);
	if (words.length <= maxTokens) {
		return text.trim();
	}

	return `${words.slice(0, maxTokens).join(" ")}...`;
}

// the `tool` helper function ensures correct type inference:
export const listAllFilesTool = tool({
	description:
		"List file IDs in stable cursor order (newest first). When given a cursor " +
		"for pagination, it will continue listing from that cursor. " +
		"When no cursor is provided, it will start listing from the beginning. " +
		"If the result shows there are more files, use the returned nextCursor to " +
		"fetch the next page of files.",
	inputSchema: z.object({
		cursor: z
			.string()
			.optional()
			.nullable()
			.describe("Opaque pagination cursor for the next page"),

		collectionId: z
			.string()
			.optional()
			.nullable()
			.describe("The collection id to list files from (optional)"),
	}),
});

export async function handleListAllFiles({
	memberCode,
	collectionId,
	cursor,
	options,
	logger,
	onEvent,
}: {
	memberCode: string;
	collectionId: string | null;
	cursor: string | null;
	options: FetchOptions;
	logger: ChatLogger;
	onEvent: (event: EventMessage) => void;
}): Promise<string> {
	onEvent({
		type: "list_all_files.started",
	});
	const { list, nextCursor, hasMore } = await fetchProtectedFiles(
		memberCode,
		{
			collectionId,
			cursor,
			limit: 100,
		},
		options,
		logger,
	);

	const normalizedFiles = normalizeFiles(list);

	if (normalizedFiles.length === 0) {
		onEvent({
			type: "list_all_files.completed",
			message: "No files found",
		});
		return "No files found";
	}

	// Build markdown table with id, title, and type columns
	const tableHeader = "| id | title | type |";
	const tableSeparator = "|---|---|---|";
	const tableRows = normalizedFiles.map((file) => {
		const id = sanitizeMarkdownTableCell(file.id);
		// Use fallback: title -> summaryTitle -> linkTitle -> empty string
		const titleText = file.title ?? file.summaryTitle ?? file.linkTitle ?? "";
		const title = sanitizeMarkdownTableCell(
			truncateToWordTokens(titleText, 12),
		);
		const type = sanitizeMarkdownTableCell(String(file.type));
		return `| ${id} | ${title} | ${type} |`;
	});

	const markdownTable = [tableHeader, tableSeparator, ...tableRows].join("\n");

	onEvent({
		type: "list_all_files.completed",
		message: "All files listed",
	});

	const filesXml = xml("files", markdownTable, { raw: true });
	const nextCursorXml = xml("nextCursor", nextCursor ?? "", { indent: 0 });
	const hasMoreXml = xml("hasMore", String(hasMore), { indent: 0 });
	const limitXml = xml("limit", String(100), { indent: 0 });

	if (collectionId) {
		return `Fetched ${normalizedFiles.length} files from collection ${collectionId}: ${filesXml}\n${nextCursorXml}\n${hasMoreXml}\n${limitXml}\n`;
	} else {
		return `Fetched ${normalizedFiles.length} files from all collections: ${filesXml}\n${nextCursorXml}\n${hasMoreXml}\n${limitXml}\n`;
	}
}
