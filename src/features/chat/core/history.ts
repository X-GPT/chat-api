import type { ModelMessage } from "ai";

export type ConversationHistory =
	| {
			type: "new";
	  }
	| {
			type: "continued";
			messages: ModelMessage[];
	  };
