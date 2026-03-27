import { describe, expect, it } from "bun:test";
import { buildSandboxAgentPrompt } from "./sandbox-agent.prompt";

describe("buildSandboxAgentPrompt", () => {
	const baseOptions = {
		docsRoot: "/workspace/sandbox-prototype/docs/user-1",
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
		expect(prompt).toContain("[c1]: detail/");
		expect(prompt).toContain("notes/3/");
	});

	it("includes retrieval strategy", () => {
		const prompt = buildSandboxAgentPrompt({
			...baseOptions,
			scope: "general",
		});

		expect(prompt).toContain("Grep");
		expect(prompt).toContain("Read");
		expect(prompt).toContain("YAML frontmatter");
	});

	it("includes source restriction rules", () => {
		const prompt = buildSandboxAgentPrompt({
			...baseOptions,
			scope: "general",
		});

		expect(prompt).toContain("ONLY use information from files");
		expect(prompt).toContain("NEVER use outside knowledge");
	});

	describe("general scope", () => {
		it("includes general scope context", () => {
			const prompt = buildSandboxAgentPrompt({
				...baseOptions,
				scope: "general",
			});

			expect(prompt).toContain("all files in your working directory");
		});
	});

	describe("collection scope", () => {
		it("includes collection scope context", () => {
			const prompt = buildSandboxAgentPrompt({
				...baseOptions,
				scope: "collection",
				collectionId: "col-123",
			});

			expect(prompt).toContain("specific collection");
			expect(prompt).toContain(
				"All files in your working directory belong to this collection",
			);
		});
	});

	describe("document scope", () => {
		it("includes document scope context with summaryId", () => {
			const prompt = buildSandboxAgentPrompt({
				...baseOptions,
				scope: "document",
				summaryId: "doc-456",
			});

			expect(prompt).toContain("single specific document");
			expect(prompt).toContain("doc-456");
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
