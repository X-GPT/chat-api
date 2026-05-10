import { updatePlanTool } from "./update-plan";

export function getAllowedTools(): "update_plan"[] {
	return ["update_plan"];
}

export function getTools() {
	return {
		update_plan: updatePlanTool,
	};
}
