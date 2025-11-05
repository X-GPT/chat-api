import { type LanguageModel, type ModelMessage, streamText } from "ai";
import type { ChatMessagesScope } from "@/config/env";
import type { ProtectedSummary } from "../api/types";
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
import { handleTaskStatus } from "../tools/task_status";
import { getTools } from "../tools/tools";
import { handleUpdateCitations } from "../tools/update-citations";
import { handleUpdatePlan } from "../tools/update-plan";
import type { RequestCache } from "./cache";
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
		summaryCache: config.summaryCache,
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
	summaryCache: RequestCache<ProtectedSummary[]>;
};

type TurnRunResult = {
	processedItems: {
		response: ModelMessage | null;
		toolResult: ModelMessage | null;
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
				console.log("Text end");
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
		output.push({ response: message, toolResult: null });
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
					toolResult: {
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
					memberCode: turnContext.memberCode,
					type: toolCall.input.type,
					fileId: toolCall.input.fileId,
					protectedFetchOptions: {
						memberAuthToken: turnContext.memberAuthToken,
					},
					logger: turnContext.logger,
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
								output: { type: "text" as const, value: toolOutput }, // update depending on the tool's output format
							},
						],
					},
				});
			} else if (
				toolCall.toolName === "list_collection_files" &&
				!toolCall.dynamic
			) {
				if (!turnContext.collectionId) {
					throw new Error("Collection ID is required");
				}
				const toolOutput = await handleListCollectionFiles({
					memberCode: turnContext.memberCode,
					cursor: toolCall.input.cursor || null,
					collectionId: turnContext.collectionId,
					options: {
						memberAuthToken: turnContext.memberAuthToken,
					},
					logger: turnContext.logger,
					onEvent: onEvent,
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
					toolResult: {
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
					summaryCache: turnContext.summaryCache,
					logger: turnContext.logger,
					onEvent,
					onCitationsUpdate,
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
			} else if (
				toolCall.toolName === "search_knowledge" &&
				!toolCall.dynamic
			) {
				const toolOutput = await handleSearchKnowledge({
					query: toolCall.input.query,
					memberCode: turnContext.memberCode,
					summaryId: turnContext.summaryId,
					collectionId: turnContext.collectionId,
					protectedFetchOptions: {
						memberAuthToken: turnContext.memberAuthToken,
					},
					summaryCache: turnContext.summaryCache,
					logger: turnContext.logger,
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
					toolResult: {
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
			} else if (toolCall.toolName === "task_status" && !toolCall.dynamic) {
				const toolOutput = handleTaskStatus({
					taskStatus: toolCall.input.taskStatus,
					onEvent,
					logger: turnContext.logger,
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
								output: { type: "text" as const, value: toolOutput.toString() },
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

		const toolResults: ModelMessage[] = [];

		for (const item of processedItems) {
			if (item.response) {
				session.messages.push(item.response);
			}
			if (item.toolResult) {
				toolResults.push(item.toolResult);
			}
		}

		// 1. If no tool results, ask the user to call the task_status tool
		// if (toolResults.length === 0) {
		// 	session.messages.push({
		// 		role: "user" as const,
		// 		content: [
		// 			{
		// 				type: "text" as const,
		// 				text:
		// 					"You haven't called any tools. " +
		// 					"If there is any tool you need to call, like read_file, update_plan, update_citations, search_knowledge, " +
		// 					"you MUST call it now. If you don't call it, the task will never be completed." +
		// 					"If the task is completed, " +
		// 					"call the task_status tool with taskStatus: complete." +
		// 					"If the task is waiting for user input, " +
		// 					"call the task_status tool with taskStatus: ask_user.",
		// 			},
		// 		],
		// 	});
		// 	continue;
		// }

		// 2. If no non-task-status tool results, the task is completed
		const nonTaskStatusToolResults = toolResults.filter((toolResult) => {
			if (
				toolResult.role === "tool" &&
				toolResult.content[0]?.type === "tool-result" &&
				toolResult.content[0]?.toolName === "task_status"
			) {
				return false;
			}
			return true;
		});
		if (nonTaskStatusToolResults.length === 0) {
			turnContext.logger.info({
				message: "Task is completed",
				messages: session.messages,
			});
			return;
		}

		// 3. Add the non-task-status tool results to the session messages
		session.messages.push(...nonTaskStatusToolResults);
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
