import { tool } from "ai";
import invariant from "tiny-invariant";
import { z } from "zod";
import type { FetchOptions } from "../api/client";
import { fetchProtectedFiles } from "../api/files";
import type { EventMessage } from "../chat.events";
import type { ChatLogger } from "../chat.logger";
import { normalizeFiles } from "./utils";

export const listCollectionFilesToolInputSchema = z.object({
	collectionId: z.string().describe("The collection id"),
	cursor: z.string().optional().nullable().describe("The pagination cursor"),
	limit: z
		.number()
		.optional()
		.nullable()
		.describe("The number of files to return per page"),
});

export type ListCollectionFilesToolInput = z.infer<
	typeof listCollectionFilesToolInputSchema
>;

// the `tool` helper function ensures correct type inference:
export const listCollectionFilesTool = tool({
	description: "List the files in a collection",
	inputSchema: listCollectionFilesToolInputSchema,
});

export async function handleListCollectionFiles({
	args,
	memberCode,
	options,
	logger,
	onEvent,
}: {
	args: ListCollectionFilesToolInput;
	memberCode: string;
	options: FetchOptions;
	logger: ChatLogger;
	onEvent: (event: EventMessage) => void;
}): Promise<string> {
	onEvent({
		type: "list_collection_files.started",
		collectionId: args.collectionId,
	});

	const { list, nextCursor, hasMore } = await fetchProtectedFiles(
		memberCode,
		{
			collectionId: args.collectionId,
			cursor: args.cursor ?? null,
			limit: args.limit ?? null,
		},
		options,
		logger,
	);
	const normalizedFiles = normalizeFiles(list);

	if (normalizedFiles.length === 0) {
		onEvent({
			type: "list_collection_files.completed",
			collectionId: args.collectionId,
			collectionName: null,
			message: `There is no files in this collection: ${args.collectionId}`,
		});
		return "No files found";
	}

	const firstFile = normalizedFiles[0];
	invariant(firstFile, "First file is required");

	const collectionName = firstFile.collections.find(
		(collection) => collection.id === args.collectionId,
	)?.name;

	invariant(collectionName, "Collection name is required");
	invariant(collectionName.length > 0, "Collection name is required");

	const fileList = normalizedFiles
		.map((file) => {
			if (!file.fileName && file.fileLink) {
				return `
				<file>
					<link>${file.fileLink}</link>
					<id>${file.id}</id>
					<type>${file.fileType}</type>
				</file>`;
			}

			return `
			<file>
				<name>${file.fileName}</name>
				<id>${file.id}</id>
				<type>${file.fileType}</type>
			</file>`;
		})
		.join("\n");

	onEvent({
		type: "list_collection_files.completed",
		collectionId: args.collectionId,
		collectionName: collectionName,
		message: `Collection ${collectionName} files listed`,
	});
	return `<collection id="${args.collectionId}" name="${collectionName}">\n${fileList}\n</collection>`;
}
