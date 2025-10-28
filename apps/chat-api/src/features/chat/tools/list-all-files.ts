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
	inputSchema: z.object({}),
});

export async function handleListAllFiles({
	partnerCode,
	protectedFetchOptions,
	logger,
	onEvent,
}: {
	partnerCode: string;
	protectedFetchOptions: FetchOptions;
	logger: ChatLogger;
	onEvent: (event: EventMessage) => void;
}): Promise<string> {
	onEvent({
		type: "list_all_files.started",
	});
	const files = await fetchProtectedFiles(
		{
			partnerCode,
		},
		protectedFetchOptions,
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
		const collectionsXml = xml(
			"collections",
			file.collections.map((collection) =>
				xml(
					"collection",
					[
						xml("id", collection.id, { indent: 3 }),
						xml("name", collection.name, { indent: 3 }),
					],
					{ indent: 2 },
				),
			),
			{ indent: 1 },
		);

		return xml("file", [
			xml("title", file.title ?? file.linkTitle ?? file.summaryTitle, {
				indent: 1,
			}),
			xml("name", file.fileName ?? "", { indent: 1 }),
			xml("id", file.summaryId, { indent: 1 }),
			xml("type", file.fileType, { indent: 1 }),
			collectionsXml,
		]);
	});

	const collections = new Map<string, string>();
	normalizedFiles.forEach((file) => {
		file.collections.forEach((collection) => {
			collections.set(collection.id, collection.name);
		});
	});

	const collectionNodes = Array.from(collections.entries()).map(([id, name]) =>
		xml(
			"collection",
			[xml("id", id, { indent: 2 }), xml("name", name, { indent: 2 })],
			{ indent: 1 },
		),
	);

	onEvent({
		type: "list_all_files.completed",
		message: "All files listed",
	});

	const filesXml = xml("files", fileNodes);
	const collectionsXml = xml("collections", collectionNodes);

	return `\n${filesXml}\n${collectionsXml}\n`;
}
