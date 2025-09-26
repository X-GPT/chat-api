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
	refsContent: string;
	chatKey: string;
	chatType: string;
	createBy: string;
	createTime: string;
	delFlag: string;
	followup: string;
	id: string;
	memberCode: string;
	memberName: string;
	partnerCode: string;
	partnerName: string;
	readFlag: string;
	remark: string;
	senderCode: string;
	senderType: string;
	updateBy: string;
	updateTime: string;
	violateFlag: string;
	collapseFlag: string; // 折叠标志（1代表展开 2代表折叠）
	voteType: number; // 是否喜欢该回答（1代表支持 2代表反对 0-none）
}

export type ChatEntity = Omit<ChatEntityEvent, "type">;
