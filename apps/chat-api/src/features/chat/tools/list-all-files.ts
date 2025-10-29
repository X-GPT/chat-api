import { tool } from "ai";
import { z } from "zod";
import type { FetchOptions } from "../api/client";
import { fetchProtectedFiles } from "../api/files";
import type { EventMessage } from "../chat.events";
import type { ChatLogger } from "../chat.logger";
import { normalizeFiles, xml } from "./utils";

// the `tool` helper function ensures correct type inference:
export const listAllFilesTool = tool({
	description: "List the files in all collections",
	inputSchema: z.object({
		pageIndex: z.number().optional().describe("The page index"),
		pageSize: z.number().optional().describe("The page size"),
	}),
});

export async function handleListAllFiles({
	memberCode,
	collectionId,
	pageIndex,
	pageSize,
	options,
	logger,
	onEvent,
}: {
	memberCode: string;
	collectionId: string | null;
	pageIndex: number | null;
	pageSize: number | null;
	options: FetchOptions;
	logger: ChatLogger;
	onEvent: (event: EventMessage) => void;
}): Promise<string> {
	onEvent({
		type: "list_all_files.started",
	});
	const files = await fetchProtectedFiles(
		memberCode,
		{
			collectionId,
			pageIndex,
			pageSize,
		},
		options,
		logger,
	);

	const normalizedFiles = normalizeFiles(files);

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

	const collections = new Map<string, string>();
	normalizedFiles.forEach((file) => {
		file.collections.forEach((collection) => {
			collections.set(collection.id, collection.name);
		});
	});

	const collectionNodes = Array.from(collections.entries()).map(
		([id, name]) => `${id}: ${name}`,
	);

	onEvent({
		type: "list_all_files.completed",
		message: "All files listed",
	});

	const filesXml = xml("files", fileNodes.join("\n"));
	const collectionsXml = xml("collections", collectionNodes.join("\n"));

	return `\n${filesXml}\n${collectionsXml}\n`;
}
