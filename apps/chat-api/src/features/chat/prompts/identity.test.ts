import { describe, expect, it } from "bun:test";
import { buildClaudeIdentity } from "./identity";

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
