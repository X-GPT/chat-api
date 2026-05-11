import { describe, expect, it } from "bun:test";
import { sanitizePathSegment } from "./sandbox-orchestration";

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

	it("replaces unicode characters with hyphens", () => {
		expect(sanitizePathSegment("文档-123")).toBe("--123");
	});
});
