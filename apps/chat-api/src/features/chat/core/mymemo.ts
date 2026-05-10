import { type LanguageModel, type ModelMessage, streamText } from "ai";
import type { EventMessage } from "../chat.events";
import {
	type LanguageModelProvider,
	resolveLanguageModel,
} from "../chat.language-models";
import type { ChatLogger } from "../chat.logger";
import { buildIdentity } from "../prompts/identity";
import {
	buildPrompt,
	getNoKnowledgePrompt,
	getSingleFilePrompt,
	getSystemPrompt,
} from "../prompts/prompts";
import { getTools } from "../tools/tools";
import { handleUpdatePlan } from "../tools/update-plan";
import type { Config } from "./config";
import type { ConversationHistory } from "./history";

export type Session = {
	messages: ModelMessage[];
};

function selectSystemPrompt(config: Config): string {
	if (config.scope === "document") {
		return getSingleFilePrompt();
	}
	if (!config.enableKnowledge) {
		return getNoKnowledgePrompt();
	}
	return getSystemPrompt();
}

function buildSession({
	config,
	conversationHistory,
	logger,
}: {
	config: Config;
	conversationHistory: ConversationHistory;
	logger: ChatLogger;
}): {
	session: Session;
	turnContext: TurnContext;
} {
	const { model, provider, isFallback, requestedModelId } =
		resolveLanguageModel(config.modelId);

	if (isFallback) {
		logger.info({
			message: "Requested model type is not supported; using fallback model",
			requestedModelType: requestedModelId ?? config.modelId,
			fallbackModelType: model,
		});
	}

	const turnContext: TurnContext = {
		model,
		provider,
		systemPrompt: selectSystemPrompt(config),
		identity: buildIdentity(config.modelId),
		logger,
	};

	const session: Session = {
		messages:
			conversationHistory.type === "continued"
				? conversationHistory.messages
				: [],
	};

	return { session, turnContext };
}

export type TurnContext = {
	model: LanguageModel;
	provider: LanguageModelProvider;
	systemPrompt: string;
	identity: string | null;
	logger: ChatLogger;
};

type TurnRunResult = {
	processedItems: {
		response: ModelMessage | null;
		toolResult: ModelMessage | null;
	}[];
};

async function runTurn(
	turnContext: TurnContext,
	turnInput: ModelMessage[],
	onTextDelta: (text: string) => void,
	onTextEnd: () => Promise<void>,
	onEvent: (event: EventMessage) => void,
): Promise<TurnRunResult> {
	const tools = getTools();
	const prompt = buildPrompt({
		systemPrompt: turnContext.systemPrompt,
		identity: turnContext.identity,
		messages: turnInput,
		tools,
	});

	turnContext.logger.info({
		message: "Prompt",
		system: prompt.system,
		allowedTools: prompt.allowedTools,
	});

	const result = streamText({
		model: turnContext.model,
		system: prompt.system,
		tools: prompt.tools,
		messages: prompt.messages,
		activeTools: prompt.allowedTools,
		onFinish: ({ usage }) => {
			const { inputTokens, outputTokens, totalTokens } = usage;
			turnContext.logger.info({
				message: "Usage",
				model: turnContext.model,
				inputTokens,
				outputTokens,
				totalTokens,
			});
		},
	});

	const output: TurnRunResult["processedItems"] = [];

	for await (const event of result.fullStream) {
		switch (event.type) {
			case "text-delta": {
				onTextDelta(event.text);
				break;
			}
			case "text-end": {
				await onTextEnd();
				break;
			}
			case "tool-call": {
				turnContext.logger.info({
					message: "Tool call requested",
					toolName: event.toolName,
				});
				break;
			}
		}
	}

	const responseMessages = (await result.response).messages;
	responseMessages.forEach((message) => {
		output.push({ response: message, toolResult: null });
	});

	const finishReason = await result.finishReason;

	if (finishReason === "tool-calls") {
		const toolCalls = await result.toolCalls;

		for (const toolCall of toolCalls) {
			turnContext.logger.info({
				message: `Handling tool call: ${toolCall.toolName}`,
				toolCallId: toolCall.toolCallId,
				toolInput: toolCall.input,
			});

			if (toolCall.toolName === "update_plan" && !toolCall.dynamic) {
				const toolOutput = await handleUpdatePlan({
					args: toolCall.input,
					onEvent,
				});
				output.push({
					response: null,
					toolResult: {
						role: "tool" as const,
						content: [
							{
								toolName: toolCall.toolName,
								toolCallId: toolCall.toolCallId,
								type: "tool-result" as const,
								output: { type: "text" as const, value: toolOutput.message },
							},
						],
					},
				});
			}
		}
	} else if (finishReason === "length") {
		turnContext.logger.info({
			message: "Model reached the maximum length",
		});
	}

	return {
		processedItems: output,
	};
}

async function runTask({
	session,
	turnContext,
	userInput,
	onTextDelta,
	onTextEnd,
	onEvent,
}: {
	session: Session;
	turnContext: TurnContext;
	userInput: string;
	onTextDelta: (text: string) => void;
	onTextEnd: () => Promise<void>;
	onEvent: (event: EventMessage) => void;
}) {
	session.messages.push({
		role: "user" as const,
		content: [{ type: "text" as const, text: userInput }],
	});
	const turnInput = session.messages;

	while (true) {
		const { processedItems } = await runTurn(
			turnContext,
			turnInput,
			onTextDelta,
			onTextEnd,
			onEvent,
		);

		const toolResults: ModelMessage[] = [];

		for (const item of processedItems) {
			if (item.response) {
				session.messages.push(item.response);
			}
			if (item.toolResult) {
				toolResults.push(item.toolResult);
			}
		}

		if (toolResults.length === 0) {
			turnContext.logger.info({
				message: "Task is completed",
				messages: session.messages,
			});
			return;
		}

		session.messages.push(...toolResults);
	}
}

export type RunMyMemoOptions = {
	config: Config;
	conversationHistory: ConversationHistory;
	userInput: string;
	onTextDelta: (text: string) => void;
	onTextEnd: () => Promise<void>;
	onEvent: (event: EventMessage) => void;
	logger: ChatLogger;
};

export async function runMyMemo({
	config,
	conversationHistory,
	userInput,
	onTextDelta,
	onTextEnd,
	onEvent,
	logger,
}: RunMyMemoOptions) {
	const { session, turnContext } = buildSession({
		config,
		conversationHistory,
		logger,
	});

	return await runTask({
		session,
		turnContext,
		userInput,
		onTextDelta,
		onTextEnd,
		onEvent,
	});
}
