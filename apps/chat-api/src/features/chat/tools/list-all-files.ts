import { tool } from "ai";
import { z } from "zod";
import type { FetchOptions } from "../api/client";
import { fetchProtectedFiles } from "../api/files";
import type { EventMessage } from "../chat.events";
import type { ChatLogger } from "../chat.logger";
import { normalizeFiles } from "./utils";

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

	const fileList = normalizedFiles
		.map((file) => {
			return [
				"<file>",
				`\t${!file.fileName && file.fileLink ? `<link>${file.fileLink}</link>` : `<name>${file.fileName}</name>`}`,
				`\t<id>${file.summaryId}</id>`,
				`\t<type>${file.fileType}</type>`,
				"\t<collections>",
				`${file.collections
					.map((collection) => {
						return `\t\t<collection id="${collection.id}" name="${collection.name}" />`;
					})
					.join("\n")}`,
				"\t</collections>",
				"</file>",
			].join("\n");
		})
		.join("\n");

	const collections = new Map<string, string>();
	normalizedFiles.forEach((file) => {
		file.collections.forEach((collection) => {
			collections.set(collection.id, collection.name);
		});
	});

	const collectionList = Array.from(collections.entries())
		.map(([id, name]) => {
			return `
		<collection>
			<id>${id}</id>
			<name>${name}</name>
		</collection>`;
		})
		.join("\n");

	onEvent({
		type: "list_all_files.completed",
		message: "All files listed",
	});

	return `\n<files>${fileList}\n</files>\n<collections>${collectionList}\n</collections>\n`;
}
