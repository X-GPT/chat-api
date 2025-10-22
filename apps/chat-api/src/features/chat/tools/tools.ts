import type { ChatMessagesScope } from "@/config/env";
import { listAllFilesTool } from "./list-all-files";
import { listCollectionFilesTool } from "./list-collection-files";
import { readFileTool } from "./read-file";
import { searchDocumentsTool } from "./search-documents";
import { searchKnowledgeTool } from "./search-knowledge";
import { updateCitationsTool } from "./update-citations";
import { updatePlanTool } from "./update-plan";

export function getTools() {
	return {
		update_plan: updatePlanTool,
		read_file: readFileTool,
		list_collection_files: listCollectionFilesTool,
		list_all_files: listAllFilesTool,
		update_citations: updateCitationsTool,
		search_knowledge: searchKnowledgeTool,
		search_documents: searchDocumentsTool,
	};
}

export function getAllowedTools(
	scope: ChatMessagesScope,
	enableKnowledge: boolean,
) {
	switch (scope) {
		case "general":
			return enableKnowledge
				? [
						"update_plan" as const,
						"read_file" as const,
						"list_collection_files" as const,
						"list_all_files" as const,
						"update_citations" as const,
						// "search_knowledge" as const,
						"search_documents" as const,
					]
				: ["update_plan" as const];
		case "collection":
			return enableKnowledge
				? [
						"update_plan" as const,
						"read_file" as const,
						"list_collection_files" as const,
						"update_citations" as const,
						// "search_knowledge" as const,
						"search_documents" as const,
					]
				: ["update_plan" as const];
		case "document":
			return enableKnowledge
				? [
						"update_plan" as const,
						"read_file" as const,
						// "search_knowledge" as const,
						"search_documents" as const,
					]
				: ["update_plan" as const];
		default:
			return ["update_plan" as const];
	}
}
