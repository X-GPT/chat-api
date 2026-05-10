import { afterAll, describe, expect, it } from "bun:test";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildCanonicalPath,
	buildCitePath,
	buildCollectionHardlink,
	clearDataRoot,
	computeChecksum,
	createEphemeralDocumentScope,
	type DocFile,
	findCanonicalDoc,
	getDataRoot,
	getMtimeSeconds,
	removeCanonicalFile,
	removeEphemeralDocumentScope,
	resolveScopeCwd,
	sanitizePathSegment,
	scanCanonicalFiles,
	scanCollectionLinks,
	stampMtime,
	toEpochSeconds,
	writeCanonicalFile,
	writeIndexFile,
} from "./materialization";

describe("materialization", () => {
	const testRoot = join(tmpdir(), `mat-test-${Date.now()}`);

	afterAll(() => {
		rmSync(testRoot, { recursive: true, force: true });
	});

	describe("sanitizePathSegment", () => {
		it("passes through alphanumeric", () => {
			expect(sanitizePathSegment("hello-world")).toBe("hello-world");
		});

		it("replaces special characters", () => {
			expect(sanitizePathSegment("foo/bar@baz")).toBe("foo-bar-baz");
		});

		it("trims whitespace", () => {
			expect(sanitizePathSegment("  hello  ")).toBe("hello");
		});

		it("returns unknown for empty string", () => {
			expect(sanitizePathSegment("")).toBe("unknown");
		});

		it("preserves dots and underscores", () => {
			expect(sanitizePathSegment("my_file.txt")).toBe("my_file.txt");
		});
	});

	describe("computeChecksum", () => {
		it("returns hex SHA-256", () => {
			const hash = computeChecksum("hello");
			expect(hash).toHaveLength(64);
			expect(hash).toBe(
				"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
			);
		});

		it("is deterministic", () => {
			expect(computeChecksum("test")).toBe(computeChecksum("test"));
		});
	});

	describe("getDataRoot", () => {
		it("builds path under /workspace/data", () => {
			expect(getDataRoot("user-1")).toBe("/workspace/data/user-1");
		});

		it("sanitizes user ID", () => {
			expect(getDataRoot("user/1@foo")).toBe("/workspace/data/user-1-foo");
		});
	});

	describe("toEpochSeconds", () => {
		it("truncates to whole seconds", () => {
			expect(toEpochSeconds("2026-01-01 00:00:00")).toBe(
				Math.floor(Date.parse("2026-01-01 00:00:00") / 1000),
			);
		});
	});

	describe("stampMtime + getMtimeSeconds round-trip", () => {
		it("stamps a file and reads back the same whole seconds", () => {
			const dataRoot = join(testRoot, "mtime-roundtrip");
			mkdirSync(dataRoot, { recursive: true });
			const path = join(dataRoot, "file.md");
			writeFileSync(path, "x");

			stampMtime(path, "2026-03-15 12:34:56");
			expect(getMtimeSeconds(path)).toBe(toEpochSeconds("2026-03-15 12:34:56"));
		});

		it("returns null for a missing file", () => {
			expect(getMtimeSeconds(join(testRoot, "no-such-file"))).toBeNull();
		});
	});

	describe("clearDataRoot", () => {
		it("removes canonical/ and collections/ and recreates canonical/", () => {
			const dataRoot = join(testRoot, "clear-test");
			mkdirSync(`${dataRoot}/canonical/0`, { recursive: true });
			mkdirSync(`${dataRoot}/collections/col-A/0`, { recursive: true });
			writeFileSync(`${dataRoot}/canonical/0/doc.md`, "content");
			writeFileSync(`${dataRoot}/collections/col-A/0/doc.md`, "content");

			clearDataRoot(dataRoot);

			expect(existsSync(`${dataRoot}/canonical`)).toBe(true);
			expect(existsSync(`${dataRoot}/canonical/0/doc.md`)).toBe(false);
			expect(existsSync(`${dataRoot}/collections`)).toBe(false);
		});
	});

	describe("buildCanonicalPath", () => {
		it("builds path with type and document_id", () => {
			expect(
				buildCanonicalPath("/data/u1", { type: 0, document_id: "doc-123" }),
			).toBe("/data/u1/canonical/0/doc-123.md");
		});

		it("sanitizes document_id", () => {
			expect(
				buildCanonicalPath("/data/u1", { type: 3, document_id: "my doc/id" }),
			).toBe("/data/u1/canonical/3/my-doc-id.md");
		});
	});

	describe("writeCanonicalFile", () => {
		it("writes title + cite frontmatter only (no collections, no checksum)", () => {
			const dataRoot = join(testRoot, "write-test");
			const doc: DocFile = {
				document_id: "123",
				type: 0,
				content: "Hello world",
			};
			writeCanonicalFile(dataRoot, doc);

			const filePath = buildCanonicalPath(dataRoot, doc);
			const text = readFileSync(filePath, "utf-8");
			expect(text).toContain('title: "123"');
			expect(text).toContain("cite: detail/0/123");
			expect(text).not.toContain("checksum:");
			expect(text).not.toContain("collections:");
			expect(text).toContain("Hello world");
		});

		it("escapes newlines in title via JSON.stringify", () => {
			const dataRoot = join(testRoot, "write-title-newline");
			writeCanonicalFile(dataRoot, {
				document_id: "nl-doc",
				type: 0,
				content: "body",
				title: "Line One\nLine Two",
			});

			const text = readFileSync(
				buildCanonicalPath(dataRoot, { document_id: "nl-doc", type: 0 }),
				"utf-8",
			);
			expect(text).toContain('title: "Line One\\nLine Two"');
			expect(text.match(/^---$/gm)).toHaveLength(2);
		});

		it("escapes YAML-special characters in title", () => {
			const dataRoot = join(testRoot, "write-title-yaml");
			writeCanonicalFile(dataRoot, {
				document_id: "yaml-doc",
				type: 0,
				content: "body",
				title: 'Node.js: A Guide [Draft] #1 & "Quoted"',
			});

			const text = readFileSync(
				buildCanonicalPath(dataRoot, { document_id: "yaml-doc", type: 0 }),
				"utf-8",
			);
			expect(text).toContain(
				'title: "Node.js: A Guide [Draft] #1 & \\"Quoted\\""',
			);
		});
	});

	describe("removeCanonicalFile", () => {
		it("removes an existing file and is safe for missing files", () => {
			const dataRoot = join(testRoot, "remove-test");
			writeCanonicalFile(dataRoot, {
				document_id: "gone",
				type: 0,
				content: "x",
			});
			const path = buildCanonicalPath(dataRoot, {
				document_id: "gone",
				type: 0,
			});
			expect(existsSync(path)).toBe(true);

			removeCanonicalFile(dataRoot, { document_id: "gone", type: 0 });
			expect(existsSync(path)).toBe(false);

			// Second call on missing file is a no-op.
			expect(() =>
				removeCanonicalFile(dataRoot, { document_id: "gone", type: 0 }),
			).not.toThrow();
		});
	});

	describe("buildCollectionHardlink", () => {
		it("creates a hardlink that shares an inode with canonical", () => {
			const dataRoot = join(testRoot, "hardlink-test");
			const doc = {
				document_id: "456",
				type: 0,
				content: "content",
			};
			writeCanonicalFile(dataRoot, doc);
			buildCollectionHardlink(dataRoot, doc, "col-A");

			const linkPath = `${dataRoot}/collections/col-A/0/456.md`;
			expect(existsSync(linkPath)).toBe(true);
			expect(lstatSync(linkPath).isSymbolicLink()).toBe(false);
			expect(statSync(linkPath).ino).toBe(
				statSync(buildCanonicalPath(dataRoot, doc)).ino,
			);
		});

		it("is idempotent", () => {
			const dataRoot = join(testRoot, "hardlink-idempotent");
			const doc = {
				document_id: "dup",
				type: 0,
				content: "content",
			};
			writeCanonicalFile(dataRoot, doc);
			buildCollectionHardlink(dataRoot, doc, "col-X");
			expect(() => buildCollectionHardlink(dataRoot, doc, "col-X")).not.toThrow();
		});
	});

	describe("scanCanonicalFiles", () => {
		it("lists every materialized doc under canonical/", () => {
			const dataRoot = join(testRoot, "scan-canonical");
			writeCanonicalFile(dataRoot, {
				document_id: "a",
				type: 0,
				content: "x",
			});
			writeCanonicalFile(dataRoot, {
				document_id: "b",
				type: 3,
				content: "y",
			});

			const found = scanCanonicalFiles(dataRoot);
			expect(found).toHaveLength(2);
			expect(found).toContainEqual({ document_id: "a", type: 0 });
			expect(found).toContainEqual({ document_id: "b", type: 3 });
		});

		it("returns [] when canonical/ is missing", () => {
			expect(scanCanonicalFiles(join(testRoot, "scan-noroot"))).toEqual([]);
		});
	});

	describe("scanCollectionLinks", () => {
		it("lists every hardlink under collections/", () => {
			const dataRoot = join(testRoot, "scan-links");
			const doc = {
				document_id: "a",
				type: 0,
				content: "x",
			};
			writeCanonicalFile(dataRoot, doc);
			buildCollectionHardlink(dataRoot, doc, "col-A");
			buildCollectionHardlink(dataRoot, doc, "col-B");

			const found = scanCollectionLinks(dataRoot);
			expect(found).toHaveLength(2);
			expect(found).toContainEqual({
				document_id: "a",
				type: 0,
				collection_id: "col-A",
			});
			expect(found).toContainEqual({
				document_id: "a",
				type: 0,
				collection_id: "col-B",
			});
		});

		it("returns [] when collections/ is missing", () => {
			expect(scanCollectionLinks(join(testRoot, "scan-nolinks"))).toEqual([]);
		});
	});

	describe("resolveScopeCwd", () => {
		it("resolves global scope to canonical/", () => {
			expect(resolveScopeCwd("/data/u1", "global")).toBe("/data/u1/canonical");
		});

		it("resolves collection scope to collections/{colId}/", () => {
			expect(resolveScopeCwd("/data/u1", "collection", "col-1")).toBe(
				"/data/u1/collections/col-1",
			);
		});

		it("resolves document scope to scopes/request-{sid}/", () => {
			expect(resolveScopeCwd("/data/u1", "document", "doc-1")).toBe(
				"/data/u1/scopes/request-doc-1",
			);
		});

		it("falls back to canonical/ when scope id is missing", () => {
			expect(resolveScopeCwd("/data/u1", "collection")).toBe(
				"/data/u1/canonical",
			);
		});
	});

	describe("ephemeral document scope", () => {
		it("creates a hardlink to canonical and removes it cleanly", () => {
			const dataRoot = join(testRoot, "ephemeral-test");
			const doc = {
				document_id: "789",
				type: 0,
				content: "ephemeral",
			};
			writeCanonicalFile(dataRoot, doc);

			const scopePath = createEphemeralDocumentScope(dataRoot, "789", doc);
			const linkPath = `${scopePath}/doc.md`;
			expect(existsSync(linkPath)).toBe(true);
			expect(statSync(linkPath).ino).toBe(
				statSync(buildCanonicalPath(dataRoot, doc)).ino,
			);

			removeEphemeralDocumentScope(dataRoot, "789");
			expect(existsSync(scopePath)).toBe(false);
		});
	});

	describe("findCanonicalDoc", () => {
		it("returns null when canonical/ is missing", () => {
			expect(
				findCanonicalDoc(join(testRoot, "find-noroot"), "doc-1"),
			).toBeNull();
		});

		it("returns null when the document isn't found", () => {
			const dataRoot = join(testRoot, "find-missing");
			writeCanonicalFile(dataRoot, {
				document_id: "doc-1",
				type: 0,
				content: "x",
			});
			expect(findCanonicalDoc(dataRoot, "doc-2")).toBeNull();
		});

		it("finds a doc by id across type directories", () => {
			const dataRoot = join(testRoot, "find-hit");
			writeCanonicalFile(dataRoot, {
				document_id: "doc-1",
				type: 0,
				content: "x",
			});
			writeCanonicalFile(dataRoot, {
				document_id: "doc-2",
				type: 3,
				content: "y",
			});
			expect(findCanonicalDoc(dataRoot, "doc-2")).toEqual({
				document_id: "doc-2",
				type: 3,
			});
		});
	});

	describe("buildCitePath", () => {
		it("builds detail path for non-note types", () => {
			expect(buildCitePath({ document_id: "doc-1", type: 0 })).toBe(
				"detail/0/doc-1",
			);
		});

		it("builds notes path for type 3", () => {
			expect(buildCitePath({ document_id: "doc-3", type: 3 })).toBe(
				"notes/3/doc-3",
			);
		});
	});

	describe("writeIndexFile", () => {
		it("generates collection-organized index with names from memberships", async () => {
			const dataRoot = join(testRoot, "index-basic");
			mkdirSync(`${dataRoot}/canonical`, { recursive: true });

			await writeIndexFile(
				dataRoot,
				[
					{ document_id: "doc-1", type: 0, title: "My Article", updated_at: "" },
					{ document_id: "doc-2", type: 3, title: "My Note", updated_at: "" },
				],
				[
					{
						document_id: "doc-1",
						collection_id: "col-A",
						collection_name: "Research",
						updated_at: "",
					},
					{
						document_id: "doc-2",
						collection_id: "col-A",
						collection_name: "Research",
						updated_at: "",
					},
					{
						document_id: "doc-2",
						collection_id: "col-B",
						collection_name: "Reading",
						updated_at: "",
					},
				],
			);

			const content = readFileSync(
				`${dataRoot}/canonical/_index.md`,
				"utf-8",
			);
			expect(content).toContain("# Collections");
			expect(content).toContain("## Research (col-A)");
			expect(content).toContain("## Reading (col-B)");
			expect(content).toContain("- My Article (0/doc-1.md)");
			expect(content).toContain("- My Note (3/doc-2.md)");
		});

		it("puts docs without memberships under Uncategorized", async () => {
			const dataRoot = join(testRoot, "index-uncategorized");
			mkdirSync(`${dataRoot}/canonical`, { recursive: true });

			await writeIndexFile(
				dataRoot,
				[{ document_id: "doc-1", type: 0, title: null, updated_at: "" }],
				[],
			);

			const content = readFileSync(
				`${dataRoot}/canonical/_index.md`,
				"utf-8",
			);
			expect(content).toContain("## Uncategorized");
			expect(content).toContain("- doc-1 (0/doc-1.md)");
		});

		it("sorts collections alphabetically by name", async () => {
			const dataRoot = join(testRoot, "index-sorted");
			mkdirSync(`${dataRoot}/canonical`, { recursive: true });

			await writeIndexFile(
				dataRoot,
				[
					{ document_id: "doc-1", type: 0, title: "Doc Z", updated_at: "" },
					{ document_id: "doc-2", type: 0, title: "Doc A", updated_at: "" },
				],
				[
					{
						document_id: "doc-1",
						collection_id: "col-Z",
						collection_name: "Zebra",
						updated_at: "",
					},
					{
						document_id: "doc-2",
						collection_id: "col-A",
						collection_name: "Alpha",
						updated_at: "",
					},
				],
			);

			const content = readFileSync(
				`${dataRoot}/canonical/_index.md`,
				"utf-8",
			);
			const alphaPos = content.indexOf("## Alpha");
			const zebraPos = content.indexOf("## Zebra");
			expect(alphaPos).toBeGreaterThan(-1);
			expect(alphaPos).toBeLessThan(zebraPos);
		});

		it("escapes newlines in titles and collection names", async () => {
			const dataRoot = join(testRoot, "index-newlines");
			mkdirSync(`${dataRoot}/canonical`, { recursive: true });

			await writeIndexFile(
				dataRoot,
				[
					{
						document_id: "doc-1",
						type: 0,
						title: "Title\nWith\nNewlines",
						updated_at: "",
					},
				],
				[
					{
						document_id: "doc-1",
						collection_id: "col-A",
						collection_name: "Collection\nName",
						updated_at: "",
					},
				],
			);

			const content = readFileSync(
				`${dataRoot}/canonical/_index.md`,
				"utf-8",
			);
			expect(content).toContain("- Title With Newlines");
			expect(content).toContain("## Collection Name (col-A)");
		});

		it("generates valid index with no entries", async () => {
			const dataRoot = join(testRoot, "index-empty");
			mkdirSync(`${dataRoot}/canonical`, { recursive: true });

			await writeIndexFile(dataRoot, [], []);

			const content = readFileSync(
				`${dataRoot}/canonical/_index.md`,
				"utf-8",
			);
			expect(content).toContain("# Collections");
			expect(content).not.toContain("## Uncategorized");
		});
	});
});
