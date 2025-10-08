import { describe, expect, it } from "bun:test";
import { escapeXml, xml } from "./utils";

describe("escapeXml", () => {
	it("escapes ampersand", () => {
		expect(escapeXml("Tom & Jerry")).toBe("Tom &amp; Jerry");
	});

	it("escapes less than", () => {
		expect(escapeXml("5 < 10")).toBe("5 &lt; 10");
	});

	it("escapes greater than", () => {
		expect(escapeXml("10 > 5")).toBe("10 &gt; 5");
	});

	it("escapes double quotes", () => {
		expect(escapeXml('Say "hello"')).toBe("Say &quot;hello&quot;");
	});

	it("escapes single quotes", () => {
		expect(escapeXml("It's working")).toBe("It&apos;s working");
	});

	it("escapes all special characters at once", () => {
		expect(escapeXml('<tag attr="value">Tom & Jerry\'s</tag>')).toBe(
			"&lt;tag attr=&quot;value&quot;&gt;Tom &amp; Jerry&apos;s&lt;/tag&gt;"
		);
	});

	it("converts numbers to strings", () => {
		expect(escapeXml(42)).toBe("42");
		expect(escapeXml(3.14)).toBe("3.14");
	});

	it("handles empty string", () => {
		expect(escapeXml("")).toBe("");
	});
});

describe("xml", () => {
	describe("basic functionality", () => {
		it("creates a simple tag with string content", () => {
			expect(xml("name", "John Doe")).toBe("<name>John Doe</name>");
		});

		it("creates a simple tag with number content", () => {
			expect(xml("age", 25)).toBe("<age>25</age>");
		});

		it("creates a self-closing tag for null content", () => {
			expect(xml("empty", null)).toBe("<empty />");
		});

		it("creates a self-closing tag for undefined content", () => {
			expect(xml("empty", undefined)).toBe("<empty />");
		});

		it("creates a self-closing tag for empty string", () => {
			expect(xml("empty", "")).toBe("<empty />");
		});

		it("creates a self-closing tag for empty array", () => {
			expect(xml("empty", [])).toBe("<empty />");
		});
	});

	describe("automatic escaping", () => {
		it("escapes special characters in content by default", () => {
			expect(xml("text", "<script>alert('xss')</script>")).toBe(
				"<text>&lt;script&gt;alert(&apos;xss&apos;)&lt;/script&gt;</text>"
			);
		});

		it("escapes ampersands in content", () => {
			expect(xml("company", "Tom & Jerry Inc.")).toBe(
				"<company>Tom &amp; Jerry Inc.</company>"
			);
		});

		it("can disable escaping with escape: false", () => {
			expect(xml("text", "Tom & Jerry", { escape: false })).toBe(
				"<text>Tom & Jerry</text>"
			);
		});

		it("can use raw option to skip escaping", () => {
			expect(xml("html", "<b>bold</b>", { raw: true })).toBe(
				"<html><b>bold</b></html>"
			);
		});
	});

	describe("indentation", () => {
		it("adds no indentation by default", () => {
			expect(xml("name", "John")).toBe("<name>John</name>");
		});

		it("adds one level of indentation", () => {
			expect(xml("name", "John", { indent: 1 })).toBe("\t<name>John</name>");
		});

		it("adds multiple levels of indentation", () => {
			expect(xml("name", "John", { indent: 3 })).toBe(
				"\t\t\t<name>John</name>"
			);
		});

		it("indents self-closing tags", () => {
			expect(xml("empty", null, { indent: 2 })).toBe("\t\t<empty />");
		});
	});

	describe("nested content with arrays", () => {
		it("creates nested tags from array content", () => {
			const result = xml("person", [
				xml("name", "John", { indent: 1 }),
				xml("age", 30, { indent: 1 }),
			]);

			expect(result).toBe(
				"<person>\n\t<name>John</name>\n\t<age>30</age>\n</person>"
			);
		});

		it("handles deeply nested structures", () => {
			const result = xml("user", [
				xml("id", 123, { indent: 1 }),
				xml("profile", [
					xml("name", "John", { indent: 2 }),
					xml("email", "john@example.com", { indent: 2 }),
				], { indent: 1 }),
			]);

			expect(result).toBe(
				"<user>\n" +
				"\t<id>123</id>\n" +
				"\t<profile>\n" +
				"\t\t<name>John</name>\n" +
				"\t\t<email>john@example.com</email>\n" +
				"\t</profile>\n" +
				"</user>"
			);
		});

		it("handles inline array content without newlines", () => {
			// When array items don't have tabs/newlines, they're joined inline
			const items = ["<item>A</item>", "<item>B</item>", "<item>C</item>"];
			const result = xml("list", items);

			expect(result).toBe("<list><item>A</item><item>B</item><item>C</item></list>");
		});

		it("handles mixed content in arrays", () => {
			const result = xml("data", [
				xml("string", "text", { indent: 1 }),
				xml("number", 42, { indent: 1 }),
				xml("empty", null, { indent: 1 }),
			]);

			expect(result).toBe(
				"<data>\n\t<string>text</string>\n\t<number>42</number>\n\t<empty />\n</data>"
			);
		});
	});

	describe("real-world use case: search results", () => {
		it("formats a simple search result", () => {
			const result = xml("searchResults", [
				xml("query", "test query", { indent: 1 }),
				xml("totalResults", 5, { indent: 1 }),
			]);

			expect(result).toBe(
				"<searchResults>\n\t<query>test query</query>\n\t<totalResults>5</totalResults>\n</searchResults>"
			);
		});

		it("formats an empty search result", () => {
			const result = xml("searchResults", [
				xml("query", "no results", { indent: 1 }),
				xml("totalResults", 0, { indent: 1 }),
				xml("message", "No results found for this query.", { indent: 1 }),
			]);

			expect(result).toBe(
				"<searchResults>\n" +
				"\t<query>no results</query>\n" +
				"\t<totalResults>0</totalResults>\n" +
				"\t<message>No results found for this query.</message>\n" +
				"</searchResults>"
			);
		});

		it("formats complex nested search results with escaping", () => {
			const matchingChild = xml("matchingChild", [
				xml("chunkIndex", 0, { indent: 3 }),
				xml("score", "0.8500", { indent: 3 }),
				xml("text", "Text with <special> & 'characters'", { indent: 3 }),
			], { indent: 2 });

			const chunk = xml("chunk", [
				xml("chunkIndex", 0, { indent: 2 }),
				xml("maxScore", "0.9200", { indent: 2 }),
				xml("matchingChildren", [matchingChild], { indent: 2 }),
			], { indent: 1 });

			const result = xml("searchResults", [
				xml("query", "test", { indent: 1 }),
				xml("chunks", [chunk], { indent: 1 }),
			]);

			expect(result).toContain("<query>test</query>");
			expect(result).toContain("<chunkIndex>0</chunkIndex>");
			expect(result).toContain("<score>0.8500</score>");
			expect(result).toContain(
				"Text with &lt;special&gt; &amp; &apos;characters&apos;"
			);
		});
	});

	describe("edge cases", () => {
		it("handles tag names with hyphens", () => {
			expect(xml("my-tag", "content")).toBe("<my-tag>content</my-tag>");
		});

		it("handles zero as content", () => {
			expect(xml("count", 0)).toBe("<count>0</count>");
		});

		it("handles negative numbers", () => {
			expect(xml("temperature", -5)).toBe("<temperature>-5</temperature>");
		});

		it("handles floating point numbers", () => {
			expect(xml("price", 19.99)).toBe("<price>19.99</price>");
		});

		it("handles very long content", () => {
			const longText = "a".repeat(1000);
			const result = xml("data", longText);
			expect(result).toBe(`<data>${longText}</data>`);
		});

		it("handles unicode characters", () => {
			expect(xml("text", "Hello 世界 🌍")).toBe("<text>Hello 世界 🌍</text>");
		});

		it("handles newlines in content", () => {
			expect(xml("text", "line1\nline2")).toBe("<text>line1\nline2</text>");
		});

		it("preserves whitespace in content", () => {
			expect(xml("text", "  spaced  ")).toBe("<text>  spaced  </text>");
		});
	});

	describe("option combinations", () => {
		it("combines indent and escape options", () => {
			expect(xml("text", "Tom & Jerry", { indent: 2, escape: false })).toBe(
				"\t\t<text>Tom & Jerry</text>"
			);
		});

		it("combines indent and raw options", () => {
			expect(xml("html", "<b>bold</b>", { indent: 1, raw: true })).toBe(
				"\t<html><b>bold</b></html>"
			);
		});

		it("raw option overrides escape option", () => {
			expect(xml("text", "<tag>", { escape: true, raw: true })).toBe(
				"<text><tag></text>"
			);
		});
	});
});

