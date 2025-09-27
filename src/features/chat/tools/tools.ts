import type { ChatMessagesScope } from "@/config/env";
import { listAllFilesTool } from "./list-all-files";
import { listCollectionFilesTool } from "./list-collection-files";
import { readFileTool } from "./read-file";
import { updatePlanTool } from "./update-plan";

export function getTools() {
	return {
		update_plan: updatePlanTool,
		read_file: readFileTool,
		list_collection_files: listCollectionFilesTool,
		list_all_files: listAllFilesTool,
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
						"list_all_files" as const,
					]
				: ["update_plan" as const];
		case "collection":
			return [
				"update_plan" as const,
				"read_file" as const,
				"list_collection_files" as const,
			];
		case "document":
			return ["update_plan" as const, "read_file" as const];
		default:
			return ["update_plan" as const];
	}
}
