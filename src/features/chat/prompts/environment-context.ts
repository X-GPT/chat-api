import type { ChatMessagesScope } from "@/config/env";

const CONTEXT_TEMPLATE = [
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

export function buildEnvironmentContext(
	scope: ChatMessagesScope,
	summaryId: string | null,
): string | null {
	if (scope === "document" && summaryId) {
		const document = `<id>${summaryId}</id>`;
		return CONTEXT_TEMPLATE.replace("{{DOCUMENT}}", document);
	}

	return null;
}
