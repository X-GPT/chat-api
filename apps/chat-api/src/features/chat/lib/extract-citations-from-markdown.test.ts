import { describe, expect, it } from "bun:test";
import { extractReferencesFromText } from "./extract-citations-from-markdown";

describe("extractReferencesFromText", () => {
	describe("empty/null input", () => {
		it("returns empty array for empty string", () => {
			expect(extractReferencesFromText("")).toEqual([]);
		});

		it("returns empty array for whitespace-only string", () => {
			expect(extractReferencesFromText("   ")).toEqual([]);
		});
	});

	describe("single reference", () => {
		it("extracts basic reference format: [c1]: 123/456", () => {
			const result = extractReferencesFromText("[c1]: 123/456");
			expect(result).toEqual([
				{ id: "456", type: 123, index: 1 },
			]);
		});

		it("extracts reference with detail prefix: [c1]: detail/123/456", () => {
			const result = extractReferencesFromText("[c1]: detail/123/456");
			expect(result).toEqual([
				{ id: "456", type: 123, index: 1 },
			]);
		});

		it("extracts reference with notes prefix: [c1]: notes/123/456", () => {
			const result = extractReferencesFromText("[c1]: notes/123/456");
			expect(result).toEqual([
				{ id: "456", type: 123, index: 1 },
			]);
		});

		it("handles reference with extra whitespace", () => {
			const result = extractReferencesFromText("[c2]:   789/101");
			expect(result).toEqual([
				{ id: "101", type: 789, index: 2 },
			]);
		});

		it("handles reference with different index values", () => {
			const result = extractReferencesFromText("[c5]: 42/99");
			expect(result).toEqual([
				{ id: "99", type: 42, index: 5 },
			]);
		});

		it("handles reference with large numbers", () => {
			const result = extractReferencesFromText("[c10]: 999999/888888");
			expect(result).toEqual([
				{ id: "888888", type: 999999, index: 10 },
			]);
		});
	});

	describe("multiple references", () => {
		it("extracts multiple distinct references in same text", () => {
			const result = extractReferencesFromText(
				"[c1]: 123/456 [c2]: 789/101"
			);
			expect(result).toEqual([
				{ id: "456", type: 123, index: 1 },
				{ id: "101", type: 789, index: 2 },
			]);
		});

		it("extracts references with different indices", () => {
			const result = extractReferencesFromText(
				"[c1]: 100/200 [c3]: 300/400 [c5]: 500/600"
			);
			expect(result).toEqual([
				{ id: "200", type: 100, index: 1 },
				{ id: "400", type: 300, index: 3 },
				{ id: "600", type: 500, index: 5 },
			]);
		});

		it("extracts references with different types", () => {
			const result = extractReferencesFromText(
				"[c1]: 10/20 [c2]: 30/40 [c3]: 50/60"
			);
			expect(result).toEqual([
				{ id: "20", type: 10, index: 1 },
				{ id: "40", type: 30, index: 2 },
				{ id: "60", type: 50, index: 3 },
			]);
		});

		it("extracts references with different IDs", () => {
			const result = extractReferencesFromText(
				"[c1]: 100/200 [c2]: 100/300 [c3]: 100/400"
			);
			expect(result).toEqual([
				{ id: "200", type: 100, index: 1 },
				{ id: "300", type: 100, index: 2 },
				{ id: "400", type: 100, index: 3 },
			]);
		});

		it("extracts mix of detail and notes prefixes", () => {
			const result = extractReferencesFromText(
				"[c1]: detail/123/456 [c2]: notes/789/101"
			);
			expect(result).toEqual([
				{ id: "456", type: 123, index: 1 },
				{ id: "101", type: 789, index: 2 },
			]);
		});
	});

	describe("duplicate handling", () => {
		it("deduplicates same type/id combination appearing multiple times", () => {
			const result = extractReferencesFromText(
				"[c1]: 123/456 [c2]: 123/456 [c3]: 123/456"
			);
			expect(result).toEqual([
				{ id: "456", type: 123, index: 1 },
			]);
		});

		it("deduplicates different indices but same type/id", () => {
			const result = extractReferencesFromText(
				"[c1]: 100/200 [c5]: 100/200 [c10]: 100/200"
			);
			expect(result).toEqual([
				{ id: "200", type: 100, index: 1 },
			]);
		});

		it("keeps first occurrence when duplicates exist", () => {
			const result = extractReferencesFromText(
				"[c1]: 123/456 [c2]: 789/101 [c3]: 123/456"
			);
			expect(result).toEqual([
				{ id: "456", type: 123, index: 1 },
				{ id: "101", type: 789, index: 2 },
			]);
		});

		it("handles duplicates with different prefixes", () => {
			const result = extractReferencesFromText(
				"[c1]: 123/456 [c2]: detail/123/456 [c3]: notes/123/456"
			);
			expect(result).toEqual([
				{ id: "456", type: 123, index: 1 },
			]);
		});

		it("does not deduplicate different types with same id", () => {
			const result = extractReferencesFromText(
				"[c1]: 100/200 [c2]: 200/200"
			);
			expect(result).toEqual([
				{ id: "200", type: 100, index: 1 },
				{ id: "200", type: 200, index: 2 },
			]);
		});

		it("does not deduplicate same type with different ids", () => {
			const result = extractReferencesFromText(
				"[c1]: 100/200 [c2]: 100/300"
			);
			expect(result).toEqual([
				{ id: "200", type: 100, index: 1 },
				{ id: "300", type: 100, index: 2 },
			]);
		});
	});

	describe("edge cases", () => {
		it("ignores malformed patterns without bracket", () => {
			const result = extractReferencesFromText("c1]: 123/456");
			expect(result).toEqual([]);
		});

		it("ignores malformed patterns without colon", () => {
			const result = extractReferencesFromText("[c1] 123/456");
			expect(result).toEqual([]);
		});

		it("ignores malformed patterns without slash", () => {
			const result = extractReferencesFromText("[c1]: 123456");
			expect(result).toEqual([]);
		});

		it("ignores patterns with missing numbers", () => {
			const result = extractReferencesFromText("[c]: 123/456");
			expect(result).toEqual([]);
		});

		it("handles references with zero index", () => {
			const result = extractReferencesFromText("[c0]: 123/456");
			expect(result).toEqual([
				{ id: "456", type: 123, index: 0 },
			]);
		});

		it("handles references with zero type", () => {
			const result = extractReferencesFromText("[c1]: 0/456");
			expect(result).toEqual([
				{ id: "456", type: 0, index: 1 },
			]);
		});

		it("handles references at different positions in text", () => {
			const result = extractReferencesFromText(
				"Start [c1]: 123/456 middle [c2]: 789/101 end"
			);
			expect(result).toEqual([
				{ id: "456", type: 123, index: 1 },
				{ id: "101", type: 789, index: 2 },
			]);
		});

		it("handles mixed valid and invalid patterns", () => {
			const result = extractReferencesFromText(
				"[c1]: 123/456 invalid [c2]: 789/101 also [c3]: 111/222"
			);
			expect(result).toEqual([
				{ id: "456", type: 123, index: 1 },
				{ id: "101", type: 789, index: 2 },
				{ id: "222", type: 111, index: 3 },
			]);
		});

		it("handles very long markdown text", () => {
			const longText = "a".repeat(1000) + "[c1]: 123/456" + "b".repeat(1000);
			const result = extractReferencesFromText(longText);
			expect(result).toEqual([
				{ id: "456", type: 123, index: 1 },
			]);
		});

		it("handles newlines in text", () => {
			const result = extractReferencesFromText(
				"[c1]: 123/456\n[c2]: 789/101\n[c3]: 111/222"
			);
			expect(result).toEqual([
				{ id: "456", type: 123, index: 1 },
				{ id: "101", type: 789, index: 2 },
				{ id: "222", type: 111, index: 3 },
			]);
		});

		it("handles references with tabs and spaces", () => {
			const result = extractReferencesFromText(
				"[c1]:\t123/456\t[c2]:  789/101"
			);
			expect(result).toEqual([
				{ id: "456", type: 123, index: 1 },
				{ id: "101", type: 789, index: 2 },
			]);
		});
	});

	describe("real-world scenarios", () => {
		it("extracts references from markdown paragraph", () => {
			const text = "This is a paragraph with a citation [c1]: 123/456 and another one [c2]: 789/101.";
			const result = extractReferencesFromText(text);
			expect(result).toEqual([
				{ id: "456", type: 123, index: 1 },
				{ id: "101", type: 789, index: 2 },
			]);
		});

		it("extracts references with surrounding markdown content", () => {
			const text = "# Header\n\nSome text with [c1]: detail/123/456 reference.\n\nMore text [c2]: notes/789/101 here.";
			const result = extractReferencesFromText(text);
			expect(result).toEqual([
				{ id: "456", type: 123, index: 1 },
				{ id: "101", type: 789, index: 2 },
			]);
		});

		it("handles multiple references in complex markdown", () => {
			const text = `
# Title

First paragraph with [c1]: 100/200.

Second paragraph mentions [c2]: 300/400 and [c3]: 500/600.

Final paragraph has [c4]: 700/800.
			`.trim();
			const result = extractReferencesFromText(text);
			expect(result).toEqual([
				{ id: "200", type: 100, index: 1 },
				{ id: "400", type: 300, index: 2 },
				{ id: "600", type: 500, index: 3 },
				{ id: "800", type: 700, index: 4 },
			]);
		});

		it("handles references with other markdown links", () => {
			const text = "Check [this link](https://example.com) and citation [c1]: 123/456.";
			const result = extractReferencesFromText(text);
			expect(result).toEqual([
				{ id: "456", type: 123, index: 1 },
			]);
		});

		it("handles references with code blocks nearby", () => {
			const text = "Code: `const x = 1;` Citation: [c1]: 123/456";
			const result = extractReferencesFromText(text);
			expect(result).toEqual([
				{ id: "456", type: 123, index: 1 },
			]);
		});

		it("handles references with markdown formatting", () => {
			const text = "**Bold** text with [c1]: 123/456 and *italic* with [c2]: 789/101";
			const result = extractReferencesFromText(text);
			expect(result).toEqual([
				{ id: "456", type: 123, index: 1 },
				{ id: "101", type: 789, index: 2 },
			]);
		});

		it("handles many references in a single text", () => {
			const text = Array.from({ length: 10 }, (_, i) => `[c${i + 1}]: ${i * 10}/${i * 100}`).join(" ");
			const result = extractReferencesFromText(text);
			expect(result).toHaveLength(10);
			expect(result[0]).toEqual({ id: "0", type: 0, index: 1 });
			expect(result[9]).toEqual({ id: "900", type: 90, index: 10 });
		});
	});
});

