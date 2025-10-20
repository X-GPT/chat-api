import type { ProtectedSummary } from "./api/types";
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
	| PlanUpdatedEvent
	| CitationsUpdatedEvent
	| ReadFileStartedEvent
	| ReadFileCompletedEvent
	| ListCollectionFilesStartedEvent
	| ListCollectionFilesCompletedEvent
	| ListAllFilesStartedEvent
	| ListAllFilesCompletedEvent
	| ReadFileStartedEvent
	| ReadFileCompletedEvent
	| SearchKnowledgeStartedEvent
	| SearchKnowledgeCompletedEvent
	| SearchDocumentsStartedEvent
	| SearchDocumentsCompletedEvent;

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

export type Citation = ProtectedSummary & {
	number: number;
};

export type CitationsUpdatedEvent = {
	type: "citations.updated";
	citations: Citation[];
};

export type ReadFileStartedEvent = {
	type: "read_file.started";
	fileId: string;
	fileName: string;
};

export type ReadFileCompletedEvent = {
	type: "read_file.completed";
	fileId: string;
	fileName: string;
	message?: string;
};

export type ListCollectionFilesStartedEvent = {
	type: "list_collection_files.started";
	collectionId: string | null;
};

export type ListCollectionFilesCompletedEvent = {
	type: "list_collection_files.completed";
	collectionId: string | null;
	collectionName: string | null;
	message: string;
};

export interface ErrorEvent {
	type: "error";
	message: string;
}

export type ListAllFilesStartedEvent = {
	type: "list_all_files.started";
};

export type ListAllFilesCompletedEvent = {
	type: "list_all_files.completed";
	message: string;
};

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

export type SearchKnowledgeStartedEvent = {
	type: "search_knowledge.started";
	query: string;
};

export type SearchKnowledgeCompletedEvent = {
	type: "search_knowledge.completed";
	query: string;
	totalResults: number;
	error?: string;
};

export type SearchDocumentsStartedEvent = {
	type: "search_documents.started";
	query: string;
};

export type SearchDocumentsCompletedEvent = {
	type: "search_documents.completed";
	query: string;
	totalDocuments: number;
	error?: string;
};
