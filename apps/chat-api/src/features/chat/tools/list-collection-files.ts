import { tool } from "ai";
import invariant from "tiny-invariant";
import { z } from "zod";
import type { EventMessage } from "../chat.events";
import { type FetchOptions, fetchProtectedFiles } from "../chat.external";
import type { ChatLogger } from "../chat.logger";
import { normalizeFiles } from "./utils";

export const listCollectionFilesToolInputSchema = z.object({
	collectionId: z.string().describe("The collection id"),
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
	partnerCode,
	protectedFetchOptions,
	logger,
	onEvent,
}: {
	args: ListCollectionFilesToolInput;
	partnerCode: string;
	protectedFetchOptions: FetchOptions;
	logger: ChatLogger;
	onEvent: (event: EventMessage) => void;
}): Promise<string> {
	onEvent({
		type: "list_collection_files.started",
		collectionId: args.collectionId,
	});

	const files = await fetchProtectedFiles(
		{
			partnerCode,
			collectionId: args.collectionId,
		},
		protectedFetchOptions,
		logger,
	);
	const normalizedFiles = normalizeFiles(files);

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
					<id>${file.summaryId}</id>
					<type>${file.fileType}</type>
				</file>`;
			}

			return `
			<file>
				<name>${file.fileName}</name>
				<id>${file.summaryId}</id>
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
