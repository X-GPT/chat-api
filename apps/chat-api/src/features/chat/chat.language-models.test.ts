import { describe, expect, it } from "bun:test";
import invariant from "tiny-invariant";
import {
	DEFAULT_MODEL_ID,
	LANGUAGE_MODELS_BY_ID,
	resolveLanguageModel,
} from "./chat.language-models";

describe("resolveLanguageModel", () => {
	it("returns the exact language model when a known OpenAI id is provided", () => {
		const id = "gpt-4o";
		const resolved = resolveLanguageModel(id);

		expect(resolved.isFallback).toBe(false);
		expect(resolved.modelId).toBe(id);
		expect(resolved.provider).toBe("openai");
		invariant(LANGUAGE_MODELS_BY_ID[id], "Language model not found");
		expect(resolved.model).toBe(LANGUAGE_MODELS_BY_ID[id].model);
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
