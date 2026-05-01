import { describe, expect, it } from "bun:test";
import {
	buildClaudeIdentity,
	buildGptIdentity,
	buildIdentity,
} from "./identity";

describe("buildClaudeIdentity", () => {
	it("returns null for null input", () => {
		expect(buildClaudeIdentity(null)).toBeNull();
	});

	it("returns null for undefined input", () => {
		expect(buildClaudeIdentity(undefined)).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(buildClaudeIdentity("")).toBeNull();
	});

	it("returns null for non-Claude model ids", () => {
		expect(buildClaudeIdentity("gpt-4o")).toBeNull();
		expect(buildClaudeIdentity("gemini-2.5-pro")).toBeNull();
		expect(buildClaudeIdentity("o1-mini")).toBeNull();
	});

	it("identifies as Claude Opus for claude-opus-* requests", () => {
		const identity = buildClaudeIdentity("claude-opus-4-20250514");
		expect(identity).toContain("Claude Opus");
		expect(identity).toContain("Anthropic");
	});

	it("identifies as Claude Opus for legacy claude-3-opus-* requests", () => {
		const identity = buildClaudeIdentity("claude-3-opus-20240229");
		expect(identity).toContain("Claude Opus");
	});

	it("identifies as Claude Sonnet for claude-sonnet-* requests", () => {
		const identity = buildClaudeIdentity("claude-sonnet-4-20250514");
		expect(identity).toContain("Claude Sonnet");
		expect(identity).not.toContain("Claude Opus");
	});

	it("identifies as Claude Sonnet for claude-3-5-sonnet-* requests", () => {
		const identity = buildClaudeIdentity("claude-3-5-sonnet-latest");
		expect(identity).toContain("Claude Sonnet");
	});

	it("identifies as generic Claude for haiku and other claude variants", () => {
		const identity = buildClaudeIdentity("claude-3-5-haiku-20241022");
		expect(identity).toContain("Claude");
		expect(identity).not.toContain("Claude Opus");
		expect(identity).not.toContain("Claude Sonnet");
	});

	it("instructs the model to never reveal the underlying provider", () => {
		const identity = buildClaudeIdentity("claude-opus-4-20250514");
		expect(identity).toMatch(/never mention/i);
		expect(identity).toContain("DeepSeek");
		expect(identity).toContain("OpenAI");
		expect(identity).toContain("Gemini");
	});
});

describe("buildGptIdentity", () => {
	it("returns null for null input", () => {
		expect(buildGptIdentity(null)).toBeNull();
	});

	it("returns null for undefined input", () => {
		expect(buildGptIdentity(undefined)).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(buildGptIdentity("")).toBeNull();
	});

	it("returns null for non-GPT model ids", () => {
		expect(buildGptIdentity("claude-opus-4-20250514")).toBeNull();
		expect(buildGptIdentity("gemini-2.5-pro")).toBeNull();
		expect(buildGptIdentity("o1-mini")).toBeNull();
		expect(buildGptIdentity("chatgpt-4o-latest")).toBeNull();
	});

	it("identifies as GPT for gpt-5 requests", () => {
		const identity = buildGptIdentity("gpt-5");
		expect(identity).toContain("You are GPT");
		expect(identity).toContain("OpenAI");
	});

	it("identifies as GPT for gpt-4o requests", () => {
		const identity = buildGptIdentity("gpt-4o");
		expect(identity).toContain("You are GPT");
		expect(identity).toContain("OpenAI");
	});

	it("does not expose the requested version in the directive", () => {
		expect(buildGptIdentity("gpt-5")).not.toContain("gpt-5");
		expect(buildGptIdentity("gpt-4o")).not.toContain("gpt-4o");
		expect(buildGptIdentity("gpt-4.1-mini")).not.toContain("gpt-4.1");
	});

	it("instructs the model to omit any specific version", () => {
		const identity = buildGptIdentity("gpt-4o");
		expect(identity).toMatch(/without naming a specific version/i);
	});

	it("instructs the model to never reveal the underlying provider or competitors", () => {
		const identity = buildGptIdentity("gpt-5");
		expect(identity).toMatch(/never mention/i);
		expect(identity).toContain("DeepSeek");
		expect(identity).toContain("Anthropic");
		expect(identity).toContain("Claude");
		expect(identity).toContain("Gemini");
	});
});

describe("buildIdentity", () => {
	it("returns null for null input", () => {
		expect(buildIdentity(null)).toBeNull();
	});

	it("returns null for undefined input", () => {
		expect(buildIdentity(undefined)).toBeNull();
	});

	it("returns null for non-routed providers", () => {
		expect(buildIdentity("gemini-2.5-pro")).toBeNull();
		expect(buildIdentity("o1-mini")).toBeNull();
		expect(buildIdentity("chatgpt-4o-latest")).toBeNull();
	});

	it("dispatches claude-* ids to the Claude identity directive", () => {
		const identity = buildIdentity("claude-opus-4-20250514");
		expect(identity).toContain("Claude Opus");
		expect(identity).toContain("Anthropic");
	});

	it("dispatches gpt-* ids to the GPT identity directive", () => {
		const identity = buildIdentity("gpt-5");
		expect(identity).toContain("You are GPT");
		expect(identity).toContain("OpenAI");
		expect(identity).toMatch(/without naming a specific version/i);
	});
});
