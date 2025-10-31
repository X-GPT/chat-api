import { tool } from "ai";
import { z } from "zod";
import type { EventMessage } from "../chat.events";
import type { ChatLogger } from "../chat.logger";

export const taskCompleteTool = tool({
	description: "Indicate whether the task is completed or not",
	inputSchema: z.object({
		taskCompleted: z.boolean().describe("Whether the task is completed or not"),
	}),
});

export function handleTaskComplete({
	taskCompleted,
	onEvent,
	logger,
}: {
	taskCompleted: boolean;
	onEvent: (event: EventMessage) => void;
	logger: ChatLogger;
}): boolean {
	onEvent({
		type: "task_completed",
		taskCompleted,
	});
	logger.info({
		message: taskCompleted
			? "Task completed"
			: "Task not completed, continuing",
		taskCompleted,
	});
	return taskCompleted;
}
