import { describe, expect, it } from "bun:test";
import type { ProtectedSummary } from "@/features/chat/api/types";
import {
	computeChecksum,
	getDocsRoot,
	materializeSummary,
	resolveContent,
	resolveSourceKind,
	sanitizePathSegment,
} from "./materialization";

const makeConfig = (userId = "user-1") => ({
	workspaceRoot: "/workspace/sandbox-prototype",
	userId,
});

const makeSummary = (
	overrides: Partial<ProtectedSummary> = {},
): ProtectedSummary => ({
	id: "100",
	type: 0,
	content: "Hello world",
	parseContent: null,
	title: "Test Doc",
	summaryTitle: null,
	fileType: null,
	delFlag: 0,
	updateTime: "2026-03-27T00:00:00Z",
	...overrides,
});

describe("sanitizePathSegment", () => {
	it("passes through alphanumeric and allowed chars", () => {
		expect(sanitizePathSegment("hello-world_1.0")).toBe("hello-world_1.0");
	});

	it("replaces spaces and special characters with hyphens", () => {
		expect(sanitizePathSegment("hello world!@#")).toBe("hello-world-");
	});

	it("collapses consecutive special chars into one hyphen", () => {
		expect(sanitizePathSegment("a   b///c")).toBe("a-b-c");
	});

	it("trims whitespace before sanitizing", () => {
		expect(sanitizePathSegment("  abc  ")).toBe("abc");
	});

	it("returns 'unknown' for empty or whitespace-only input", () => {
		expect(sanitizePathSegment("")).toBe("unknown");
		expect(sanitizePathSegment("   ")).toBe("unknown");
	});

	it("handles unicode characters", () => {
		expect(sanitizePathSegment("文档-123")).toBe("--123");
	});
});

describe("computeChecksum", () => {
	it("returns a 64-character hex string", () => {
		const result = computeChecksum("hello");
		expect(result).toHaveLength(64);
		expect(result).toMatch(/^[0-9a-f]{64}$/);
	});

	it("is deterministic", () => {
		const a = computeChecksum("same content");
		const b = computeChecksum("same content");
		expect(a).toBe(b);
	});

	it("differs for different content", () => {
		const a = computeChecksum("content A");
		const b = computeChecksum("content B");
		expect(a).not.toBe(b);
	});

	it("handles empty string", () => {
		const result = computeChecksum("");
		expect(result).toHaveLength(64);
	});
});

describe("resolveSourceKind", () => {
	it("returns 'parser_output' for PDF", () => {
		expect(
			resolveSourceKind(makeSummary({ fileType: "application/pdf" })),
		).toBe("parser_output");
	});

	it("returns 'parser_output' for normal links", () => {
		expect(resolveSourceKind(makeSummary({ fileType: "link/normal" }))).toBe(
			"parser_output",
		);
	});

	it("returns 'parser_output' for video links", () => {
		expect(resolveSourceKind(makeSummary({ fileType: "link/video" }))).toBe(
			"parser_output",
		);
	});

	it("returns 'markdown' for type 3 (notes)", () => {
		expect(resolveSourceKind(makeSummary({ type: 3 }))).toBe("markdown");
	});

	it("returns 'text' for other types", () => {
		expect(resolveSourceKind(makeSummary({ type: 0 }))).toBe("text");
		expect(resolveSourceKind(makeSummary({ type: 6 }))).toBe("text");
	});

	it("parser_output takes precedence over type 3 for PDFs", () => {
		expect(
			resolveSourceKind(makeSummary({ type: 3, fileType: "application/pdf" })),
		).toBe("parser_output");
	});
});

describe("resolveContent", () => {
	it("returns content for text type", () => {
		expect(
			resolveContent(
				makeSummary({ content: "raw", parseContent: "parsed", type: 0 }),
			),
		).toBe("raw");
	});

	it("returns parseContent for parser_output type", () => {
		expect(
			resolveContent(
				makeSummary({
					content: "raw",
					parseContent: "parsed",
					fileType: "application/pdf",
				}),
			),
		).toBe("parsed");
	});

	it("falls back to parseContent when content is null", () => {
		expect(
			resolveContent(makeSummary({ content: null, parseContent: "parsed" })),
		).toBe("parsed");
	});

	it("falls back to content when parseContent is null for PDF", () => {
		expect(
			resolveContent(
				makeSummary({
					content: "raw",
					parseContent: null,
					fileType: "application/pdf",
				}),
			),
		).toBe("raw");
	});

	it("returns empty string when both are null", () => {
		expect(
			resolveContent(makeSummary({ content: null, parseContent: null })),
		).toBe("");
	});
});

describe("getDocsRoot", () => {
	it("builds the correct path", () => {
		expect(getDocsRoot(makeConfig("user-1"))).toBe(
			"/workspace/sandbox-prototype/docs/user-1",
		);
	});

	it("sanitizes the userId", () => {
		expect(getDocsRoot(makeConfig("user with spaces"))).toBe(
			"/workspace/sandbox-prototype/docs/user-with-spaces",
		);
	});
});

describe("materializeSummary", () => {
	it("produces correct frontmatter format", () => {
		const result = materializeSummary(makeSummary(), makeConfig());
		const lines = result.content.split("\n");

		expect(lines[0]).toBe("---");
		expect(lines[1]).toBe("summaryId: 100");
		expect(lines[2]).toBe("type: 0");
		expect(lines[3]).toBe("sourceKind: text");
		expect(lines[4]).toBe('title: "Test Doc"');
		expect(lines[5]).toBe("---");
		expect(lines[6]).toBe("");
		expect(lines[7]).toBe("Hello world");
		expect(lines[8]).toBe("");
	});

	it("builds correct path", () => {
		const result = materializeSummary(makeSummary({ id: "456" }), makeConfig());
		expect(result.path).toBe(
			"/workspace/sandbox-prototype/docs/user-1/0/456.txt",
		);
		expect(result.relativePath).toBe("0/456.txt");
	});

	it("uses summaryTitle as fallback when title is null", () => {
		const result = materializeSummary(
			makeSummary({ title: null, summaryTitle: "Fallback Title" }),
			makeConfig(),
		);
		expect(result.content).toContain('title: "Fallback Title"');
	});

	it("uses empty string when both titles are null", () => {
		const result = materializeSummary(
			makeSummary({ title: null, summaryTitle: null }),
			makeConfig(),
		);
		expect(result.content).toContain('title: ""');
	});

	it("trims content", () => {
		const result = materializeSummary(
			makeSummary({ content: "  hello  \n\n" }),
			makeConfig(),
		);
		// Body should be trimmed, followed by trailing newline
		const lines = result.content.split("\n");
		expect(lines[7]).toBe("hello");
	});

	it("defaults type to 0 when null", () => {
		const result = materializeSummary(
			makeSummary({ type: null }),
			makeConfig(),
		);
		expect(result.type).toBe(0);
		expect(result.content).toContain("type: 0");
	});

	it("computes a checksum", () => {
		const result = materializeSummary(makeSummary(), makeConfig());
		expect(result.checksum).toHaveLength(64);
		expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
	});

	it("checksum is deterministic for same input", () => {
		const a = materializeSummary(makeSummary(), makeConfig());
		const b = materializeSummary(makeSummary(), makeConfig());
		expect(a.checksum).toBe(b.checksum);
		expect(a.content).toBe(b.content);
	});

	it("checksum changes when content changes", () => {
		const a = materializeSummary(
			makeSummary({ content: "version 1" }),
			makeConfig(),
		);
		const b = materializeSummary(
			makeSummary({ content: "version 2" }),
			makeConfig(),
		);
		expect(a.checksum).not.toBe(b.checksum);
	});

	it("handles special characters in title via JSON.stringify", () => {
		const result = materializeSummary(
			makeSummary({ title: 'He said "hello"' }),
			makeConfig(),
		);
		expect(result.content).toContain('title: "He said \\"hello\\""');
	});
});
