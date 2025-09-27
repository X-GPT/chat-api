import type { ChatMessagesScope } from "@/config/env";

const SINGLE_DOCUMENT_CONTEXT_TEMPLATE = [
	"---",
	"",
	"### Context",
	"",
	"<document>",
	"{{DOCUMENT}}",
	"</document>",
	"",
	"---",
].join("\n");

const COLLECTION_CONTEXT_TEMPLATE = [
	"---",
	"",
	"### Context",
	"",
	"<collection>",
	"{{COLLECTION}}",
	"</collection>",
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
		return SINGLE_DOCUMENT_CONTEXT_TEMPLATE.replace("{{DOCUMENT}}", document);
	}

	if (scope === "collection" && collectionId) {
		const collection = `<id>${collectionId}</id>`;
		return COLLECTION_CONTEXT_TEMPLATE.replace("{{COLLECTION}}", collection);
	}

	if (scope === "general" && enableKnowledge) {
		return "You have access to all files in the system. You can list all files in the system using the list_all_files tool.";
	}

	if (scope === "general" && !enableKnowledge) {
		return "You don't have access to any files in the system. You can't use any file related tools.";
	}

	return null;
}
