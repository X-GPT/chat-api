import type { ChatMessagesScope } from "@/config/env";

const SINGLE_DOCUMENT_CONTEXT_TEMPLATE = [
	"---",
	"",
	"### Context",
	"",
	"You have access to the following files:",
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
	"You have access to the following collection:",
	"",
	"<collection>",
	"{{COLLECTION}}",
	"</collection>",
	"",
	"---",
].join("\n");

const ALL_FILES_CONTEXT_TEMPLATE = [
	"---",
	"",
	"### Context",
	"",
	"You have access to the following files:",
	"",
	"---",
].join("\n");

const NO_FILES_CONTEXT_TEMPLATE = [
	"---",
	"",
	"### Context",
	"",
	"You don't have access to any files in the system. You can't use any file related tools.",
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
		return ALL_FILES_CONTEXT_TEMPLATE;
	}

	if (scope === "general" && !enableKnowledge) {
		return NO_FILES_CONTEXT_TEMPLATE;
	}

	return null;
}
