import { tool } from "ai";
import { z } from "zod";
import type { EventMessage } from "../chat.events";

export const updatePlanToolInputSchema = z.object({
	plan: z.array(
		z.object({
			step: z.string().describe("The step to update"),
			status: z
				.enum(["pending", "in_progress", "completed"])
				.describe("The status of the step"),
		}),
	),
});

export type UpdatePlanToolInput = z.infer<typeof updatePlanToolInputSchema>;

// the `tool` helper function ensures correct type inference:
export const updatePlanTool = tool({
	description: "Update the plan",
	inputSchema: updatePlanToolInputSchema,
});

export async function handleUpdatePlan({
	args,
	onEvent,
}: {
	args: UpdatePlanToolInput;
	onEvent: (event: EventMessage) => void;
}) {
	onEvent({
		type: "plan_update",
		plan: args.plan,
	});
	return {
		plan: args.plan,
		message: "Plan updated",
	};
}
