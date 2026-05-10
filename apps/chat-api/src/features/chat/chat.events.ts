export interface MymemoEvent {
	id: string;
	message: EventMessage;
}

export type EventMessage = ErrorEvent | ChatEntityEvent;

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
	refsContent: string | null;
	collapseFlag: string;
}

export type ChatEntity = Omit<ChatEntityEvent, "type">;
