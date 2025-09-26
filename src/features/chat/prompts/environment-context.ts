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

	return null;
}
