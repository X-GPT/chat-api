export interface MymemoEvent {
	id: string;
	message: EventMessage;
}

export type EventMessage =
	| ErrorEvent
	| TextDeltaEvent
	| DoneEvent
	| SessionIdEvent;

export interface ErrorEvent {
	type: "error";
	message: string;
}

export interface SessionIdEvent {
	type: "session_id";
	sessionId: string;
}

export interface TextDeltaEvent {
	type: "text_delta";
	text: string;
}

export interface DoneEvent {
	type: "done";
}
