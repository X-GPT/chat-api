import { tool } from "ai";
import invariant from "tiny-invariant";
import { z } from "zod";
import type { EventMessage } from "../chat.events";
import {
	type FetchOptions,
	fetchProtectedFiles,
	type ProtectedFileMetadata,
} from "../chat.external";
import type { ChatLogger } from "../chat.logger";

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

function normalizeFiles(
	files: ProtectedFileMetadata[],
): ProtectedFileMetadata[] {
	return files.map((file) => {
		if (file.type === 3) {
			return {
				...file,
				fileName: `note-${file.summaryId}`,
				fileType: "text/html",
			};
		} else if (file.type === 6) {
			return {
				...file,
				fileName: `memocast-${file.summaryId}`,
				fileType: "audio/wav",
			};
		}
		return file;
	});
}

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
			type: "list_collection_files",
			collection: `There is no files in this collection: ${args.collectionId}`,
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
		.map(
			(file) => `
			<file>
				<name>${file.fileName}</name>
				<id>${file.summaryId}</id>
				<type>${file.fileType}</type>
			</file>`,
		)
		.join("\n");

	onEvent({
		type: "list_collection_files",
		collection: collectionName,
	});
	return `<collection id="${args.collectionId}" name="${collectionName}">\n${fileList}\n</collection>`;
}
