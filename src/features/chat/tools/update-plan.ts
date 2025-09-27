import { tool } from "ai";
import { z } from "zod";
import type { EventMessage } from "../chat.events";

export const updatePlanToolInputSchema = z.object({
	explanation: z
		.string()
		.optional()
		.describe("The explanation for the plan update"),
	plan: z
		.array(
			z.object({
				step: z.string(),
				status: z
					.enum(["pending", "in_progress", "completed"])
					.describe(
						"The status of the step, one of pending, in_progress, completed",
					),
			}),
		)
		.describe("The list of steps to update"),
});

export type UpdatePlanToolInput = z.infer<typeof updatePlanToolInputSchema>;

// the `tool` helper function ensures correct type inference:
export const updatePlanTool = tool({
	description: `Update the task plan.
Provide an optional explanation and a list of plan items, each with a step and status.
At most one step can be in_progress at a time.`,
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
		explanation: args.explanation,
		plan: args.plan,
	});
	return {
		message: "Plan updated",
	};
}
