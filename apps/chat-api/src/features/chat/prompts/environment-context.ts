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
	"**CRITICAL RULES:**",
	"- You must answer ONLY using the provided file.",
	"- If the file does not contain the answer, explicitly state: 'I cannot find this information in the provided file.'",
	"- You must answer only using information explicitly stated in the provided file.",
	"- Do NOT use outside knowledge, general knowledge, or external information to answer questions.",
	"- Do NOT add facts, claims, or information not present in the source material.",
	"- Do NOT make inferences beyond what is directly stated in the file.",
	"- If information is missing, explicitly state that it is not available in the file.",
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
	"**CRITICAL RULES:**",
	"- You must answer ONLY using the files in the provided collection.",
	"- You must use the read_file tool to read the files in the collection before answering questions.",
	"- If the files in the collection do not contain the answer, explicitly state: 'I cannot find this information in the provided collection.'",
	"- You must answer only using information explicitly stated in the files you have read from the collection.",
	"- Do NOT use outside knowledge, general knowledge, or external information to answer questions.",
	"- Do NOT add facts, claims, or information not present in the source files.",
	"- Do NOT make inferences beyond what is directly stated in the files.",
	"- If information is missing, explicitly state that it is not available in the collection.",
	"",
	"---",
].join("\n");

const ALL_FILES_CONTEXT_TEMPLATE = [
	"---",
	"",
	"### Context",
	"",
	"You have access to all files in the system. You can list all files names and ids in the system using the list_all_files tool.",
	"",
	"**CRITICAL RULES:**",
	"- You must answer ONLY using files in the system.",
	"- You MUST use the available tools (list_all_files, read_file, search_knowledge) to find and read files before answering.",
	"- If the files in the system do not contain the answer, explicitly state: 'I cannot find this information in the available files.'",
	"- You must answer only using information explicitly stated in the files you have read from the system.",
	"- Do NOT use outside knowledge, general knowledge, or external information to answer questions.",
	"- Do NOT add facts, claims, or information not present in the source files.",
	"- Do NOT make inferences beyond what is directly stated in the files.",
	"- If information is missing, explicitly state that it is not available in the system files.",
	"- Always read files using the read_file tool before answering questions about their content.",
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
		const document = `<id>${summaryId}</id>\n<type>0</type>`;
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
