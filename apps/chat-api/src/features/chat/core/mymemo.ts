import { type LanguageModel, type ModelMessage, streamText, tool } from "ai";
import type { ChatMessagesScope } from "@/config/env";
import type { Citation, EventMessage } from "../chat.events";
import {
	type LanguageModelProvider,
	resolveLanguageModel,
} from "../chat.language-models";
import type { ChatLogger } from "../chat.logger";
import { buildEnvironmentContext } from "../prompts/environment-context";
import { buildPrompt, getSystemPrompt } from "../prompts/prompts";
import { handleListAllFiles } from "../tools/list-all-files";
import { handleListCollectionFiles } from "../tools/list-collection-files";
import { handleReadFile } from "../tools/read-file";
import { handleSearchDocuments } from "../tools/search-documents";
import { handleSearchKnowledge } from "../tools/search-knowledge";
import { getTools } from "../tools/tools";
import { handleUpdateCitations } from "../tools/update-citations";
import { handleUpdatePlan } from "../tools/update-plan";
import type { Config } from "./config";
import type { ConversationHistory } from "./history";

export type Session = {
	messages: ModelMessage[];
};

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
	const environmentContext = buildEnvironmentContext(
		config.scope,
		config.enableKnowledge,
		config.summaryId,
		config.collectionId,
	);

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
		systemPrompt: getSystemPrompt(),
		environmentContext,
		memberAuthToken: config.memberAuthToken,
		scope: config.scope,
		summaryId: config.summaryId,
		collectionId: config.collectionId,
		memberCode: config.memberCode,
		partnerCode: config.partnerCode,
		enableKnowledge: config.enableKnowledge,
		logger,
	};

	const session = {
		messages:
			conversationHistory.type === "new" && provider === "openai"
				? [
						{
							role: "user" as const,
							content: [
								{ type: "text" as const, text: environmentContext ?? "" },
							],
						},
					]
				: conversationHistory.type === "continued"
					? conversationHistory.messages
					: [],
	};

	return { session, turnContext };
}

export type TurnContext = {
	model: LanguageModel;
	provider: LanguageModelProvider;
	systemPrompt: string;
	environmentContext: string | null;
	memberAuthToken: string;
	scope: ChatMessagesScope;
	summaryId: string | null;
	collectionId: string | null;
	memberCode: string;
	partnerCode: string;
	enableKnowledge: boolean;
	logger: ChatLogger;
};

type TurnRunResult = {
	processedItems: {
		response: ModelMessage | null;
		nextTurnInput: ModelMessage | null;
	}[];
};

async function runTurn(
	_session: Session,
	turnContext: TurnContext,
	turnInput: ModelMessage[],
	onTextDelta: (text: string) => void,
	onTextEnd: () => Promise<void>,
	onEvent: (event: EventMessage) => void,
	onCitationsUpdate: (citations: Citation[]) => void,
): Promise<TurnRunResult> {
	const tools = getTools();
	const prompt = buildPrompt({
		systemPrompt: turnContext.systemPrompt,
		environmentContext: turnContext.environmentContext,
		messages: turnInput,
		scope: turnContext.scope,
		enableKnowledge: turnContext.enableKnowledge,
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
				console.log("Calling tool:", event.toolName);
				break;
			}
		}
	}

	const responseMessages = (await result.response).messages;
	responseMessages.forEach((message) => {
		output.push({ response: message, nextTurnInput: null });
	});

	const finishReason = await result.finishReason;

	if (finishReason === "tool-calls") {
		const toolCalls = await result.toolCalls;

		// Handle all tool call execution here
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
					nextTurnInput: {
						role: "tool" as const,
						content: [
							{
								toolName: toolCall.toolName,
								toolCallId: toolCall.toolCallId,
								type: "tool-result" as const,
								output: { type: "text" as const, value: toolOutput.message }, // update depending on the tool's output format
							},
						],
					},
				});
			} else if (toolCall.toolName === "read_file" && !toolCall.dynamic) {
				const toolOutput = await handleReadFile({
					fileId: toolCall.input.fileId,
					protectedFetchOptions: {
						memberAuthToken: turnContext.memberAuthToken,
					},
					logger: turnContext.logger,
					onEvent,
				});
				output.push({
					response: null,
					nextTurnInput: {
						role: "tool" as const,
						content: [
							{
								toolName: toolCall.toolName,
								toolCallId: toolCall.toolCallId,
								type: "tool-result" as const,
								output: { type: "text" as const, value: toolOutput }, // update depending on the tool's output format
							},
						],
					},
				});
			} else if (
				toolCall.toolName === "list_collection_files" &&
				!toolCall.dynamic
			) {
				const toolOutput = await handleListCollectionFiles({
					args: toolCall.input,
					memberCode: turnContext.memberCode,
					options: {
						memberAuthToken: turnContext.memberAuthToken,
					},
					logger: turnContext.logger,
					onEvent,
				});
				output.push({
					response: null,
					nextTurnInput: {
						role: "tool" as const,
						content: [
							{
								toolName: toolCall.toolName,
								toolCallId: toolCall.toolCallId,
								type: "tool-result" as const,
								output: { type: "text" as const, value: toolOutput }, // update depending on the tool's output format
							},
						],
					},
				});
			} else if (toolCall.toolName === "list_all_files" && !toolCall.dynamic) {
				const toolOutput = await handleListAllFiles({
					memberCode: turnContext.memberCode,
					collectionId: toolCall.input.collectionId || null,
					cursor: toolCall.input.cursor || null,
					options: {
						memberAuthToken: turnContext.memberAuthToken,
					},
					logger: turnContext.logger,
					onEvent,
				});
				output.push({
					response: null,
					nextTurnInput: {
						role: "tool" as const,
						content: [
							{
								toolName: toolCall.toolName,
								toolCallId: toolCall.toolCallId,
								type: "tool-result" as const,
								output: { type: "text" as const, value: toolOutput }, // update depending on the tool's output format
							},
						],
					},
				});
			} else if (
				toolCall.toolName === "update_citations" &&
				!toolCall.dynamic
			) {
				const toolOutput = await handleUpdateCitations({
					args: toolCall.input,
					protectedFetchOptions: {
						memberAuthToken: turnContext.memberAuthToken,
					},
					logger: turnContext.logger,
					onEvent,
					onCitationsUpdate,
				});
				output.push({
					response: null,
					nextTurnInput: {
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
			} else if (
				toolCall.toolName === "search_knowledge" &&
				!toolCall.dynamic
			) {
				const toolOutput = await handleSearchKnowledge({
					query: toolCall.input.query,
					memberCode: turnContext.memberCode,
					summaryId: turnContext.summaryId,
					collectionId: turnContext.collectionId,
					logger: turnContext.logger,
					onEvent,
				});
				output.push({
					response: null,
					nextTurnInput: {
						role: "tool" as const,
						content: [
							{
								toolName: toolCall.toolName,
								toolCallId: toolCall.toolCallId,
								type: "tool-result" as const,
								output: { type: "text" as const, value: toolOutput },
							},
						],
					},
				});
			} else if (
				toolCall.toolName === "search_documents" &&
				!toolCall.dynamic
			) {
				const toolOutput = await handleSearchDocuments({
					query: toolCall.input.query,
					memberCode: turnContext.memberCode,
					partnerCode: turnContext.partnerCode,
					collectionId: turnContext.collectionId,
					protectedFetchOptions: {
						memberAuthToken: turnContext.memberAuthToken,
					},
					logger: turnContext.logger,
					onEvent,
				});
				output.push({
					response: null,
					nextTurnInput: {
						role: "tool" as const,
						content: [
							{
								toolName: toolCall.toolName,
								toolCallId: toolCall.toolCallId,
								type: "tool-result" as const,
								output: { type: "text" as const, value: toolOutput },
							},
						],
					},
				});
			}

			// Handle other tool calls
		}
	} else if (finishReason === "length") {
		// Model hit the max context length; rely on caller to decide next steps.
		turnContext.logger.info({
			message: "Model reached the maximum length",
		});
	} else {
		// Don't push anything to the output when the model doesn't request to use any more tools
		// console.log("\\n\\nFinal message history:");
		// console.dir(session.messages, { depth: null });
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
	onCitationsUpdate,
}: {
	session: Session;
	turnContext: TurnContext;
	userInput: string;
	onTextDelta: (text: string) => void;
	onTextEnd: () => Promise<void>;
	onEvent: (event: EventMessage) => void;
	onCitationsUpdate: (citations: Citation[]) => void;
}) {
	session.messages.push({
		role: "user" as const,
		content: [{ type: "text" as const, text: userInput }],
	});
	const turnInput = session.messages;

	while (true) {
		const { processedItems } = await runTurn(
			session,
			turnContext,
			turnInput,
			onTextDelta,
			onTextEnd,
			onEvent,
			onCitationsUpdate,
		);

		const nextTurnInput: ModelMessage[] = [];

		for (const item of processedItems) {
			if (item.response) {
				session.messages.push(item.response);
			}
			if (item.nextTurnInput) {
				session.messages.push(item.nextTurnInput);
				nextTurnInput.push(item.nextTurnInput);
			}
		}

		if (nextTurnInput.length === 0) {
			turnContext.logger.info({
				message: "Final message history:",
				messages: session.messages,
			});
			break;
		}
	}
}

export type RunMyMemoOptions = {
	config: Config;
	conversationHistory: ConversationHistory;
	userInput: string;
	onTextDelta: (text: string) => void;
	onTextEnd: () => Promise<void>;
	onEvent: (event: EventMessage) => void;
	onCitationsUpdate: (citations: Citation[]) => void;
	logger: ChatLogger;
};

export async function runMyMemo({
	config,
	conversationHistory,
	userInput,
	onTextDelta,
	onTextEnd,
	onEvent,
	onCitationsUpdate,
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
		onCitationsUpdate,
	});
}
