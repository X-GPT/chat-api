import { tool } from "ai";
import { z } from "zod";
import type { FetchOptions } from "../api/client";
import { fetchProtectedFiles } from "../api/files";
import type { EventMessage } from "../chat.events";
import type { ChatLogger } from "../chat.logger";
import { normalizeFiles, xml } from "./utils";

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

	const fileNodes = normalizedFiles.map((file) => {
		return file.id;
	});

	onEvent({
		type: "list_all_files.completed",
		message: "All files listed",
	});

	const filesXml = xml("files", fileNodes.join("\n"));
	const nextCursorXml = xml("nextCursor", nextCursor ?? "", { indent: 0 });
	const hasMoreXml = xml("hasMore", String(hasMore), { indent: 0 });
	const limitXml = xml("limit", String(100), { indent: 0 });

	return `${filesXml}\n${nextCursorXml}\n${hasMoreXml}\n${limitXml}\n`;
}
