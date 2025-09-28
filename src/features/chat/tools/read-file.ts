import { tool } from "ai";
import { z } from "zod";
import type { EventMessage } from "../chat.events";
import { type FetchOptions, fetchProtectedFileDetail } from "../chat.external";
import type { ChatLogger } from "../chat.logger";

// the `tool` helper function ensures correct type inference:
export const readFileTool = tool({
	description: "Read a file by file id",
	inputSchema: z.object({
		fileId: z.string().describe("The file ID to read"),
	}),
});

export async function handleReadFile({
	fileId,
	protectedFetchOptions,
	logger,
	onEvent,
}: {
	fileId: string;
	protectedFetchOptions: FetchOptions;
	logger: ChatLogger;
	onEvent: (event: EventMessage) => void;
}) {
	onEvent({
		type: "read_file.started",
		fileId: fileId,
		fileName: "",
	});
	const fileDetail = await fetchProtectedFileDetail(
		0,
		fileId,
		protectedFetchOptions,
		logger,
	);

	switch (fileDetail?.fileType) {
		case "application/pdf":
			onEvent({
				type: "read_file.completed",
				fileId: fileId,
				fileName: fileDetail?.fileName || "",
			});
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
			onEvent({
				type: "read_file.completed",
				fileId: fileId,
				fileName: fileDetail.fileLink,
			});
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
			onEvent({
				type: "read_file.completed",
				fileId: fileId,
				fileName: fileDetail.fileLink,
			});
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
			onEvent({
				type: "read_file.completed",
				fileId: fileId,
				fileName: fileDetail.fileName,
			});
			return `
			<fileContent>
				${fileDetail.content}
			</fileContent>
			<fileName>
				${fileDetail.fileName}
			</fileName>
			<fileType>
				${fileDetail.fileType}
			</fileType>
			`;

		default:
			onEvent({
				type: "read_file.completed",
				fileId: fileId,
				fileName: "",
			});
			throw new Error("File detail is null");
	}
}
