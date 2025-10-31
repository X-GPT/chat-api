import { tool } from "ai";
import { z } from "zod";
import type { EventMessage } from "../chat.events";
import type { ChatLogger } from "../chat.logger";

export const taskStatusTool = tool({
	description:
		"Indicate the current status of the task" +
		"\n- ask_user: Waiting for user input/clarification" +
		"\n- complete: Task is fully completed",
	inputSchema: z.object({
		taskStatus: z
			.enum(["ask_user", "complete"])
			.describe("The current status of the task"),
	}),
});

export function handleTaskStatus({
	taskStatus,
	onEvent,
	logger,
}: {
	taskStatus: "ask_user" | "complete";
	onEvent: (event: EventMessage) => void;
	logger: ChatLogger;
}): "ask_user" | "complete" {
	onEvent({
		type: "task_status",
		taskStatus,
	});
	logger.info({
		message: taskStatus,
		taskStatus,
	});
	return taskStatus;
}
