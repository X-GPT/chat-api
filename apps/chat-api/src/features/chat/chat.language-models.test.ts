import { describe, expect, it } from "bun:test";
import invariant from "tiny-invariant";
import {
	DEFAULT_MODEL_ID,
	LANGUAGE_MODELS_BY_ID,
	resolveLanguageModel,
} from "./chat.language-models";

describe("resolveLanguageModel", () => {
	it("returns the exact language model when a known OpenAI reasoning id is provided", () => {
		const id = "o3-mini";
		const resolved = resolveLanguageModel(id);

		expect(resolved.isFallback).toBe(false);
		expect(resolved.modelId).toBe(id);
		expect(resolved.provider).toBe("openai");
		invariant(LANGUAGE_MODELS_BY_ID[id], "Language model not found");
		expect(resolved.model).toBe(LANGUAGE_MODELS_BY_ID[id].model);
	});

	it("keeps chatgpt-* requests on the OpenAI provider", () => {
		const id = "chatgpt-4o-latest";
		const resolved = resolveLanguageModel(id);

		expect(resolved.isFallback).toBe(false);
		expect(resolved.provider).toBe("openai");
	});

	it("routes gpt-5* requests through DeepSeek pro", () => {
		const id = "gpt-5";
		const resolved = resolveLanguageModel(id);

		expect(resolved.isFallback).toBe(false);
		expect(resolved.modelId).toBe(id);
		expect(resolved.provider).toBe("deepseek");
		invariant(LANGUAGE_MODELS_BY_ID[id], "Language model not found");
		expect(resolved.model).toBe(LANGUAGE_MODELS_BY_ID[id].model);
	});

	it("routes gpt-5-mini requests through DeepSeek pro", () => {
		const resolved = resolveLanguageModel("gpt-5-mini");

		expect(resolved.isFallback).toBe(false);
		expect(resolved.provider).toBe("deepseek");
	});

	it("routes non gpt-5 gpt-* requests through DeepSeek (default flash)", () => {
		const id = "gpt-4o";
		const resolved = resolveLanguageModel(id);

		expect(resolved.isFallback).toBe(false);
		expect(resolved.modelId).toBe(id);
		expect(resolved.provider).toBe("deepseek");
	});

	it("routes legacy gpt-3.5-turbo through DeepSeek", () => {
		const resolved = resolveLanguageModel("gpt-3.5-turbo");

		expect(resolved.isFallback).toBe(false);
		expect(resolved.provider).toBe("deepseek");
	});

	it("routes claude-opus-* requests through DeepSeek", () => {
		const id = "claude-opus-4-20250514";
		const resolved = resolveLanguageModel(id);

		expect(resolved.isFallback).toBe(false);
		expect(resolved.modelId).toBe(id);
		expect(resolved.provider).toBe("deepseek");
		invariant(LANGUAGE_MODELS_BY_ID[id], "Language model not found");
		expect(resolved.model).toBe(LANGUAGE_MODELS_BY_ID[id].model);
	});

	it("routes legacy claude-3-opus-* requests through DeepSeek", () => {
		const id = "claude-3-opus-20240229";
		const resolved = resolveLanguageModel(id);

		expect(resolved.isFallback).toBe(false);
		expect(resolved.provider).toBe("deepseek");
	});

	it("routes claude-sonnet-* requests through DeepSeek", () => {
		const id = "claude-sonnet-4-20250514";
		const resolved = resolveLanguageModel(id);

		expect(resolved.isFallback).toBe(false);
		expect(resolved.provider).toBe("deepseek");
	});

	it("routes claude-haiku-* requests through DeepSeek", () => {
		const id = "claude-3-5-haiku-20241022";
		const resolved = resolveLanguageModel(id);

		expect(resolved.isFallback).toBe(false);
		expect(resolved.provider).toBe("deepseek");
	});

	it("leaves Google models on the Google provider", () => {
		const id = "gemini-2.5-pro";
		const resolved = resolveLanguageModel(id);

		expect(resolved.isFallback).toBe(false);
		expect(resolved.provider).toBe("google");
	});

	it("falls back to the default model when an unknown id is requested", () => {
		const requestedId = "unknown-model";
		const resolved = resolveLanguageModel(requestedId);

		expect(resolved.isFallback).toBe(true);
		expect(resolved.requestedModelId).toBe(requestedId);
		expect(resolved.modelId).toBe(DEFAULT_MODEL_ID);
		expect(resolved.provider).toBe("deepseek");
		invariant(
			LANGUAGE_MODELS_BY_ID[DEFAULT_MODEL_ID],
			"Language model not found",
		);
		expect(resolved.model).toBe(LANGUAGE_MODELS_BY_ID[DEFAULT_MODEL_ID].model);
	});

	it("falls back to the default model when no id is provided", () => {
		const resolved = resolveLanguageModel(undefined);

		expect(resolved.isFallback).toBe(true);
		expect(resolved.requestedModelId).toBeUndefined();
		expect(resolved.modelId).toBe(DEFAULT_MODEL_ID);
		expect(resolved.provider).toBe("deepseek");
		invariant(
			LANGUAGE_MODELS_BY_ID[DEFAULT_MODEL_ID],
			"Language model not found",
		);
		expect(resolved.model).toBe(LANGUAGE_MODELS_BY_ID[DEFAULT_MODEL_ID].model);
	});
});
