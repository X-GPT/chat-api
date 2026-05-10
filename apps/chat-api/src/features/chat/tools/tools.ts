import type { ChatMessagesScope } from "@/config/env";
import { updatePlanTool } from "./update-plan";

export function getTools() {
	return {
		update_plan: updatePlanTool,
	};
}

export function getAllowedTools(
	_scope: ChatMessagesScope,
	_enableKnowledge: boolean,
) {
	return ["update_plan" as const];
}
