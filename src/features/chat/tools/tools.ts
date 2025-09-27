import type { ChatMessagesScope } from "@/config/env";
import { listCollectionFilesTool } from "./list-collection-files";
import { readFileTool } from "./read-file";
import { updatePlanTool } from "./update-plan";

export function getTools() {
	return {
		update_plan: updatePlanTool,
		read_file: readFileTool,
		list_collection_files: listCollectionFilesTool,
	};
}

export function getAllowedTools(
	scope: ChatMessagesScope,
	enableKnowledge: boolean,
) {
	switch (scope) {
		case "collection":
			return [
				"update_plan" as const,
				"read_file" as const,
				"list_collection_files" as const,
			];
		case "document":
			return ["update_plan" as const, "read_file" as const];
		case "general":
			return enableKnowledge
				? [
						"update_plan" as const,
						"read_file" as const,
						"list_collection_files" as const,
					]
				: ["update_plan" as const];
		default:
			return ["update_plan" as const];
	}
}
