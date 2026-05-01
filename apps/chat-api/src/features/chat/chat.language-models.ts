import { createDeepSeek } from "@ai-sdk/deepseek";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import invariant from "tiny-invariant";
import { apiEnv } from "@/config/env";

export const DEFAULT_MODEL_ID = "claude-3-5-haiku-20241022";

export type LanguageModelProvider =
	| "openai"
	| "anthropic"
	| "google"
	| "deepseek";

type LanguageModelEntry = {
	model: LanguageModel;
	provider: LanguageModelProvider;
};

const DEEPSEEK_PRO_MODEL_ID = "deepseek-v4-pro";

const deepseek = createDeepSeek({
	apiKey: apiEnv.DEEPSEEK_API_KEY,
	...(apiEnv.DEEPSEEK_BASE_URL ? { baseURL: apiEnv.DEEPSEEK_BASE_URL } : {}),
});

const resolveClaudeBackend = (modelId: string): string =>
	/opus/i.test(modelId)
		? DEEPSEEK_PRO_MODEL_ID
		: apiEnv.DEEPSEEK_DEFAULT_MODEL;

const resolveGptBackend = (modelId: string): string =>
	/^gpt-5/i.test(modelId)
		? DEEPSEEK_PRO_MODEL_ID
		: apiEnv.DEEPSEEK_DEFAULT_MODEL;

const createDeepseekMap = <TModelId extends string>(
	modelIds: readonly TModelId[],
	resolveBackend: (modelId: TModelId) => string,
) =>
	modelIds.reduce<Record<string, LanguageModelEntry>>(
		(accumulator, modelId) => {
			accumulator[modelId] = {
				model: deepseek(resolveBackend(modelId)),
				provider: "deepseek",
			};
			return accumulator;
		},
		{},
	);

const createModelMap = <TModelId extends string>(
	provider: LanguageModelProvider,
	modelIds: readonly TModelId[],
	factory: (modelId: TModelId) => LanguageModel,
) =>
	modelIds.reduce<Record<string, LanguageModelEntry>>(
		(accumulator, modelId) => {
			accumulator[modelId] = {
				model: factory(modelId),
				provider,
			};
			return accumulator;
		},
		{},
	);

export const LANGUAGE_MODELS_BY_ID = {
	...createDeepseekMap(
		[
			"gpt-4o",
			"gpt-4o-mini",
			"gpt-4o-2024-05-13",
			"gpt-4o-2024-08-06",
			"gpt-4o-2024-11-20",
			"gpt-4o-audio-preview",
			"gpt-4o-audio-preview-2024-10-01",
			"gpt-4o-audio-preview-2024-12-17",
			"gpt-4o-mini-2024-07-18",
			"gpt-4o-mini-search-preview",
			"gpt-4o-mini-search-preview-2025-03-11",
			"gpt-4o-search-preview",
			"gpt-4o-search-preview-2025-03-11",
			"gpt-5",
			"gpt-5-2025-08-07",
			"gpt-5-mini",
			"gpt-5-mini-2025-08-07",
			"gpt-5-nano",
			"gpt-5-nano-2025-08-07",
			"gpt-4.1",
			"gpt-4.1-2025-04-14",
			"gpt-4.1-mini",
			"gpt-4.1-mini-2025-04-14",
			"gpt-4.1-nano",
			"gpt-4.1-nano-2025-04-14",
			"gpt-4.5-preview",
			"gpt-4.5-preview-2025-02-27",
			"gpt-4-turbo",
			"gpt-4-turbo-2024-04-09",
			"gpt-4-turbo-preview",
			"gpt-4-0125-preview",
			"gpt-4-0613",
			"gpt-4",
			"gpt-3.5-turbo",
			"gpt-3.5-turbo-0125",
			"gpt-3.5-turbo-1106",
			"gpt-3.5-turbo-instruct",
		] as const,
		resolveGptBackend,
	),
	...createModelMap(
		"openai",
		[
			"chatgpt-4o-latest",
			"o1",
			"o1-2024-12-17",
			"o1-mini",
			"o1-mini-2024-09-12",
			"o1-preview",
			"o1-preview-2024-09-12",
			"o3",
			"o3-2025-04-16",
			"o3-mini",
			"o3-mini-2025-01-31",
			"o4-mini",
			"o4-mini-2025-04-16",
		],
		openai,
	),
	...createDeepseekMap(
		[
			"claude-3-opus-20240229",
			"claude-3-opus-latest",
			"claude-3-sonnet-20240229",
			"claude-3-haiku-20240307",
			"claude-3-5-sonnet-20240620",
			"claude-3-5-sonnet-20241022",
			"claude-3-5-sonnet-latest",
			"claude-3-5-haiku-20241022",
			"claude-3-5-haiku-latest",
			"claude-3-7-sonnet-20250219",
			"claude-sonnet-4-20250514",
			"claude-opus-4-20250514",
		] as const,
		resolveClaudeBackend,
	),
	...createModelMap(
		"google",
		[
			"gemini-1.5-flash",
			"gemini-1.5-flash-001",
			"gemini-1.5-flash-002",
			"gemini-1.5-flash-8b",
			"gemini-1.5-flash-8b-001",
			"gemini-1.5-flash-8b-latest",
			"gemini-1.5-flash-latest",
			"gemini-1.5-pro",
			"gemini-1.5-pro-001",
			"gemini-1.5-pro-002",
			"gemini-1.5-pro-latest",
			"gemini-2.0-flash",
			"gemini-2.0-flash-001",
			"gemini-2.0-flash-exp",
			"gemini-2.0-flash-lite",
			"gemini-2.0-flash-live-001",
			"gemini-2.0-flash-thinking-exp-01-21",
			"gemini-2.0-pro-exp-02-05",
			"gemini-2.5-flash",
			"gemini-2.5-flash-image-preview",
			"gemini-2.5-flash-lite",
			"gemini-2.5-flash-preview-04-17",
			"gemini-2.5-pro",
			"gemini-2.5-pro-exp-03-25",
			"gemini-exp-1206",
			"gemma-3-12b-it",
			"gemma-3-27b-it",
		],
		google,
	),
} satisfies Record<string, LanguageModelEntry>;

export const DEFAULT_LANGUAGE_MODEL =
	LANGUAGE_MODELS_BY_ID[DEFAULT_MODEL_ID]?.model;

export const resolveLanguageModel = (modelId: string | null | undefined) => {
	const requestedId = modelId ?? undefined;
	const nextModelEntry = requestedId
		? LANGUAGE_MODELS_BY_ID[requestedId]
		: undefined;

	if (nextModelEntry) {
		return {
			model: nextModelEntry.model,
			modelId: requestedId,
			provider: nextModelEntry.provider,
			isFallback: false,
		};
	}

	const defaultModelEntry = LANGUAGE_MODELS_BY_ID[DEFAULT_MODEL_ID];
	invariant(defaultModelEntry, "DEFAULT_LANGUAGE_MODEL is required");

	return {
		model: defaultModelEntry.model,
		modelId: DEFAULT_MODEL_ID,
		provider: defaultModelEntry.provider,
		isFallback: true,
		requestedModelId: requestedId,
	};
};
