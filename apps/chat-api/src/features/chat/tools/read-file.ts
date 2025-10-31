import { tool } from "ai";
import { z } from "zod";
import type { FetchOptions } from "../api/client";
import { fetchProtectedFileDetail } from "../api/files";
import type { EventMessage } from "../chat.events";
import type { ChatLogger } from "../chat.logger";
import { xml } from "./utils";

// the `tool` helper function ensures correct type inference:
export const readFileTool = tool({
	description: "Read a file by file id",
	inputSchema: z.object({
		type: z.number().int().min(0).max(12).describe("The file type"),
		fileId: z.string().describe("The file ID to read"),
	}),
});

export async function handleReadFile({
	memberCode,
	fileId,
	protectedFetchOptions,
	logger,
	onEvent,
}: {
	memberCode: string;
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
		memberCode,
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
			return xml("file", [
				xml("id", fileDetail.id, { indent: 1 }),
				xml("content", fileDetail.parseContent, { indent: 1 }),
				xml("name", fileDetail.fileName ?? "", { indent: 1 }),
				xml("type", fileDetail.fileType ?? "", { indent: 1 }),
			]);

		case "link/normal":
			onEvent({
				type: "read_file.completed",
				fileId: fileId,
				fileName: fileDetail.fileLink,
			});
			return xml("file", [
				xml("id", fileDetail.id, { indent: 1 }),
				xml("content", fileDetail.parseContent, { indent: 1 }),
				xml("link", fileDetail.fileLink ?? "", { indent: 1 }),
				xml("type", fileDetail.fileType ?? "", { indent: 1 }),
			]);

		case "link/video":
			onEvent({
				type: "read_file.completed",
				fileId: fileId,
				fileName: fileDetail.fileLink,
			});
			return xml("file", [
				xml("id", fileDetail.id, { indent: 1 }),
				xml("content", fileDetail.parseContent, { indent: 1 }),
				xml("link", fileDetail.fileLink ?? "", { indent: 1 }),
				xml("type", fileDetail.fileType ?? "", { indent: 1 }),
			]);

		case "image/jpeg":
			onEvent({
				type: "read_file.completed",
				fileId: fileId,
				fileName: fileDetail.fileName,
			});
			return xml("file", [
				xml("id", fileDetail.id, { indent: 1 }),
				xml("content", fileDetail.content ?? "", { indent: 1 }),
				xml("name", fileDetail.fileName ?? "", { indent: 1 }),
				xml("type", fileDetail.fileType ?? "", { indent: 1 }),
			]);

		default:
			logger.error({
				message: "File detail is null",
				fileDetail,
			});
			onEvent({
				type: "read_file.completed",
				fileId: fileId,
				fileName: "",
				message: "File detail is null",
			});
			throw new Error("File detail is null");
	}
}
