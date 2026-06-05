import { describe, expect, it } from "bun:test";
import { buildSandboxAgentPrompt } from "./sandbox-agent.prompt";

describe("buildSandboxAgentPrompt", () => {
	const baseOptions = {
		summaryId: null,
		collectionId: null,
		conversationContext: null,
	};

	it("includes citation format instructions", () => {
		const prompt = buildSandboxAgentPrompt({
			...baseOptions,
			scope: "general",
		});

		expect(prompt).toContain("[[N]][cN]");
		expect(prompt).toContain("passageId");
		expect(prompt).toContain("[c1]: p_abc123");
	});

	it("instructs use of the mymemo-docs CLI", () => {
		const prompt = buildSandboxAgentPrompt({
			...baseOptions,
			scope: "general",
		});

		expect(prompt).toContain("mymemo-docs search");
		expect(prompt).toContain("mymemo-docs fetch");
	});

	it("includes source restriction rules", () => {
		const prompt = buildSandboxAgentPrompt({
			...baseOptions,
			scope: "general",
		});

		expect(prompt).toContain("ONLY use information from documents");
		expect(prompt).toContain("NEVER use outside knowledge");
	});

	describe("general scope", () => {
		it("includes general scope context", () => {
			const prompt = buildSandboxAgentPrompt({
				...baseOptions,
				scope: "general",
			});

			expect(prompt).toContain("across all of the user's documents");
		});
	});

	describe("collection scope", () => {
		it("explains search is auto-restricted to the collection", () => {
			const prompt = buildSandboxAgentPrompt({
				...baseOptions,
				scope: "collection",
				collectionId: "col-123",
			});

			expect(prompt).toContain("single collection");
			expect(prompt).toContain("automatically restricted");
		});
	});

	describe("document scope", () => {
		it("explains search is auto-restricted to the document", () => {
			const prompt = buildSandboxAgentPrompt({
				...baseOptions,
				scope: "document",
				summaryId: "doc-456",
			});

			expect(prompt).toContain("single specific document");
			expect(prompt).toContain("automatically restricted");
		});
	});

	it("appends conversation context when provided", () => {
		const prompt = buildSandboxAgentPrompt({
			...baseOptions,
			scope: "general",
			conversationContext: "User previously asked about budgets.",
		});

		expect(prompt).toContain("Conversation Context");
		expect(prompt).toContain("User previously asked about budgets.");
	});

	it("does not include conversation context section when null", () => {
		const prompt = buildSandboxAgentPrompt({
			...baseOptions,
			scope: "general",
			conversationContext: null,
		});

		expect(prompt).not.toContain("Conversation Context");
	});
});
