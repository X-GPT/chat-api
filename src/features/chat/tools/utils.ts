import type { ProtectedFileMetadata } from "../chat.external";

export function normalizeFiles(
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
