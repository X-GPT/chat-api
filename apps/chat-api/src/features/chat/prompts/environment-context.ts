import type { ChatMessagesScope } from "@/config/env";

const SINGLE_DOCUMENT_CONTEXT_TEMPLATE = [
	"---",
	"",
	"### Context",
	"",
	"You have access to the following file:",
	"",
	"<file>",
	"{{FILE}}",
	"</file>",
	"",
	"You must answer only using the provided file.",
	"If the file does not contain the answer, say you cannot find it.",
	"You must answer only using information explicitly stated in the provided file.",
	"You may use your general knowledge to interpret and explain concepts found in the file.",
	"Do not add facts or claims not present in the source material.",
	"",
	"---",
].join("\n");

const COLLECTION_CONTEXT_TEMPLATE = [
	"---",
	"",
	"### Context",
	"",
	"You have access to the following collection:",
	"",
	"<collection>",
	"{{COLLECTION}}",
	"</collection>",
	"",
	"You must answer only using the provided collection.",
	"If the collection does not contain the answer, say you cannot find it.",
	"You must answer only using information explicitly stated in the provided documents.",
	"You may use your general knowledge to interpret and explain concepts found in the documents.",
	"Do not add facts or claims not present in the source material.",
	"",
	"---",
].join("\n");

const ALL_FILES_CONTEXT_TEMPLATE = [
	"---",
	"",
	"### Context",
	"",
	"You have access to the all files in the system. You can list all files names and ids in the system using the list_all_files tool.",
	"",
	"You must answer only using files in the system.",
	"If the files do not contain the answer, say you cannot find it.",
	"You must answer only using information explicitly stated in the provided files.",
	"Do not use outside knowledge to interpret and explain concepts found in the files.",
	"Do not add facts or claims not present in the source material.",
	"",
	"---",
].join("\n");

const NO_FILES_CONTEXT_TEMPLATE = [
	"---",
	"",
	"### Context",
	"",
	"You don't have access to any files in the system. You can't use any file related tools.",
	"",
	"---",
].join("\n");

export function buildEnvironmentContext(
	scope: ChatMessagesScope,
	enableKnowledge: boolean,
	summaryId: string | null,
	collectionId: string | null,
): string | null {
	if (scope === "document" && summaryId) {
		const document = `<id>${summaryId}</id>`;
		return SINGLE_DOCUMENT_CONTEXT_TEMPLATE.replace("{{FILE}}", document);
	}

	if (scope === "collection" && collectionId) {
		const collection = `<id>${collectionId}</id>`;
		return COLLECTION_CONTEXT_TEMPLATE.replace("{{COLLECTION}}", collection);
	}

	if (scope === "general" && enableKnowledge) {
		return ALL_FILES_CONTEXT_TEMPLATE;
	}

	if (scope === "general" && !enableKnowledge) {
		return NO_FILES_CONTEXT_TEMPLATE;
	}

	return null;
}
