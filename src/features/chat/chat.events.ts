import type { UpdatePlanToolInput } from "./tools/update-plan";

export interface MymemoEvent {
	id: string;
	message: EventMessage;
}

export type EventMessage =
	| AgentMessageDeltaEvent
	| ErrorEvent
	| ChatEntityEvent
	| PlanUpdateEvent
	| ReadFileEvent
	| ListCollectionFilesEvent;

export interface AgentMessageDeltaEvent {
	type: "agent_message_delta";
	delta: string;
}

export type PlanUpdateEvent = UpdatePlanToolInput & {
	type: "plan_update";
};

export type ReadFileEvent = {
	type: "read_file";
	document: string;
};

export type ListCollectionFilesEvent = {
	type: "list_collection_files";
	collection: string;
};

export interface ErrorEvent {
	type: "error";
	message: string;
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
	collapseFlag: string;
}

export type ChatEntity = Omit<ChatEntityEvent, "type">;
