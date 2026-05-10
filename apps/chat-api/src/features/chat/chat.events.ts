import type { UpdatePlanToolInput } from "./tools/update-plan";

export interface MymemoEvent {
	id: string;
	message: EventMessage;
}

export type EventMessage =
	| AgentMessageDeltaEvent
	| TaskStartEvent
	| ErrorEvent
	| ChatEntityEvent
	| PingEvent
	| PlanUpdatedEvent
	| CitationsUpdatedEvent
	| TaskStatusEvent;

export interface TaskStartEvent {
	type: "task.started";
	taskId: string;
}

export interface AgentMessageDeltaEvent {
	type: "agent.message.delta";
	delta: string;
}

export type PlanUpdatedEvent = UpdatePlanToolInput & {
	type: "plan.updated";
};

export type Citation = {
	id: string;
	type: number;
	number: number;
};

export type CitationsUpdatedEvent = {
	type: "citations.updated";
	citations: Citation[];
};

export interface ErrorEvent {
	type: "error";
	message: string;
}

export interface PingEvent {
	type: "ping";
}

export interface ChatEntityEvent {
	type: "chat_entity";
	chatContent: string;
	chatKey: string;
	chatType: string;
	delFlag: string;
	followup: string;
	id: string;
	memberCode: string | null;
	memberName: string | null;
	partnerCode: string | null;
	partnerName: string | null;
	readFlag: string;
	senderCode: string | null;
	senderType: string;
	summaryId: string | null;
	endFlag: number;
	collectionId: string | null;
	teamCode: string | null;
	refsId: string | null;
	refsContent: string | null;
	collapseFlag: string;
}

export type ChatEntity = Omit<ChatEntityEvent, "type">;

export type TaskStatusEvent = {
	type: "task_status";
	taskStatus: "ask_user" | "complete";
};
