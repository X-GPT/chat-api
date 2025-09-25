import { tool } from "ai";
import { z } from "zod";
import type { EventMessage } from "../chat.events";
import { type FetchOptions, fetchProtectedFileDetail } from "../chat.external";
import type { ChatLogger } from "../chat.logger";

// the `tool` helper function ensures correct type inference:
export const readFileTool = tool({
	description: "Read a file",
	inputSchema: z.object({
		documentId: z.string().describe("The document ID to read"),
	}),
});

export async function handleReadFile({
	documentId,
	protectedFetchOptions,
	logger,
	onEvent,
}: {
	documentId: string;
	protectedFetchOptions: FetchOptions;
	logger: ChatLogger;
	onEvent: (event: EventMessage) => void;
}) {
	const fileDetail = await fetchProtectedFileDetail(
		0,
		documentId,
		protectedFetchOptions,
		logger,
	);

	onEvent({
		type: "read_file",
		document:
			fileDetail?.fileType === "application/pdf"
				? fileDetail.fileName
				: fileDetail?.fileType === "link/normal"
					? fileDetail.fileLink
					: fileDetail?.fileType === "link/video"
						? fileDetail.fileLink
						: fileDetail?.fileType === "image/jpeg"
							? fileDetail.fileName
							: "",
	});

	switch (fileDetail?.fileType) {
		case "application/pdf":
			return `
			<fileContent>
				${fileDetail.parseContent}
			</fileContent>
			<fileName>
				${fileDetail.fileName}
			</fileName>
			<fileType>
				${fileDetail.fileType}
			</fileType>
			`;

		case "link/normal":
			return `
			<fileContent>
				${fileDetail.parseContent}
			</fileContent>
			<fileLink>
				${fileDetail.fileLink}
			</fileLink>
			<fileType>
				${fileDetail.fileType}
			</fileType>
			`;

		case "link/video":
			return `
			<fileContent>
				${fileDetail.parseContent}
			</fileContent>
			<fileLink>
				${fileDetail.fileLink}
			</fileLink>
			<fileType>
				${fileDetail.fileType}
			</fileType>
			`;

		case "image/jpeg":
			return `
			<fileContent>
				${fileDetail.parseContent}
			</fileContent>
			<fileName>
				${fileDetail.fileName}
			</fileName>
			<fileType>
				${fileDetail.fileType}
			</fileType>
			`;

		default:
			throw new Error("File detail is null");
	}
}
