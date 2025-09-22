import { describe, expect, it } from "bun:test";
import {
	DEFAULT_MODEL_ID,
	LANGUAGE_MODELS_BY_ID,
	resolveLanguageModel,
} from "./chat.language-models";

describe("resolveLanguageModel", () => {
	it("returns the exact language model when a known id is provided", () => {
		const id = "gpt-4o";
		const resolved = resolveLanguageModel(id);

		expect(resolved.isFallback).toBe(false);
		expect(resolved.modelId).toBe(id);
		expect(resolved.model).toBe(LANGUAGE_MODELS_BY_ID[id]);
	});

	it("falls back to the default model when an unknown id is requested", () => {
		const requestedId = "unknown-model";
		const resolved = resolveLanguageModel(requestedId);

		expect(resolved.isFallback).toBe(true);
		expect(resolved.requestedModelId).toBe(requestedId);
		expect(resolved.modelId).toBe(DEFAULT_MODEL_ID);
		expect(resolved.model).toBe(LANGUAGE_MODELS_BY_ID[DEFAULT_MODEL_ID]);
	});

	it("falls back to the default model when no id is provided", () => {
		const resolved = resolveLanguageModel(undefined);

		expect(resolved.isFallback).toBe(true);
		expect(resolved.requestedModelId).toBeUndefined();
		expect(resolved.modelId).toBe(DEFAULT_MODEL_ID);
		expect(resolved.model).toBe(LANGUAGE_MODELS_BY_ID[DEFAULT_MODEL_ID]);
	});
});
