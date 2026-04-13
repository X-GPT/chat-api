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
	countCanonicalFiles,
	createEphemeralDocumentScope,
	type DocFile,
	findCanonicalDoc,
	getDataRoot,
	parseCollectionIds,
	readManifest,
	removeCanonicalFile,
	removeEphemeralDocumentScope,
	resolveScopeCwd,
	sanitizePathSegment,
	writeCanonicalFile,
	writeIndexFile,
	writeManifest,
} from "./materialization";

describe("materialization", () => {
	const testRoot = join(tmpdir(), `mat-test-${Date.now()}`);
	const emptyCollectionNames = new Map<string, string>();

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

		it("differs for different content", () => {
			expect(computeChecksum("a")).not.toBe(computeChecksum("b"));
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

	describe("parseCollectionIds", () => {
		it("returns empty array for empty string", () => {
			expect(parseCollectionIds("")).toEqual([]);
		});

		it("parses a single collection id", () => {
			expect(parseCollectionIds("col-A")).toEqual(["col-A"]);
		});

		it("parses multiple comma-separated ids", () => {
			expect(parseCollectionIds("col-A,col-B")).toEqual(["col-A", "col-B"]);
		});

		it("trims whitespace and filters empty segments", () => {
			expect(parseCollectionIds(" col-A , , col-B ")).toEqual([
				"col-A",
				"col-B",
			]);
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

	describe("countCanonicalFiles", () => {
		it("counts .md files across type directories", () => {
			const dataRoot = join(testRoot, "count-test");
			writeCanonicalFile(
				dataRoot,
				{ document_id: "a", type: 0, collections: [], content: "x", checksum: "c1" },
				emptyCollectionNames,
			);
			writeCanonicalFile(
				dataRoot,
				{ document_id: "b", type: 3, collections: [], content: "y", checksum: "c2" },
				emptyCollectionNames,
			);
			expect(countCanonicalFiles(dataRoot)).toBe(2);
		});

		it("returns 0 when canonical/ is missing", () => {
			expect(countCanonicalFiles(join(testRoot, "count-noroot"))).toBe(0);
		});

		it("returns 0 when canonical/ is empty", () => {
			const dataRoot = join(testRoot, "count-empty");
			mkdirSync(`${dataRoot}/canonical`, { recursive: true });
			expect(countCanonicalFiles(dataRoot)).toBe(0);
		});
	});

	describe("buildCanonicalPath", () => {
		it("builds path with type and document_id", () => {
			const path = buildCanonicalPath("/data/u1", {
				type: 0,
				document_id: "doc-123",
			});
			expect(path).toBe("/data/u1/canonical/0/doc-123.md");
		});

		it("sanitizes document_id", () => {
			const path = buildCanonicalPath("/data/u1", {
				type: 3,
				document_id: "my doc/id",
			});
			expect(path).toBe("/data/u1/canonical/3/my-doc-id.md");
		});

		it("distinct document_ids produce distinct paths", () => {
			const path1 = buildCanonicalPath("/data/u1", {
				type: 0,
				document_id: "id-1",
			});
			const path2 = buildCanonicalPath("/data/u1", {
				type: 0,
				document_id: "id-2",
			});
			expect(path1).not.toBe(path2);
		});
	});

	describe("writeCanonicalFile + removeCanonicalFile", () => {
		it("writes file with agent-facing frontmatter and removes it", () => {
			const dataRoot = join(testRoot, "write-test");

			const doc: DocFile = {
				document_id: "123",
				type: 0,
				collections: [],
				content: "Hello world",
				checksum: "abc",
			};

			writeCanonicalFile(dataRoot, doc, emptyCollectionNames);

			const filePath = buildCanonicalPath(dataRoot, doc);
			expect(existsSync(filePath)).toBe(true);

			const content = readFileSync(filePath, "utf-8");
			expect(content).toContain('title: "123"');
			expect(content).toContain("cite: detail/0/123");
			// No checksum in frontmatter — it lives in .manifest.json
			expect(content).not.toContain("checksum:");
			// Empty collections → no collections line
			expect(content).not.toContain("collections:");
			expect(content).toContain("Hello world");

			removeCanonicalFile(dataRoot, doc);
			expect(existsSync(filePath)).toBe(false);
		});

		it("emits collections with human-readable names when non-empty", () => {
			const dataRoot = join(testRoot, "write-collections-test");
			const doc: DocFile = {
				document_id: "456",
				type: 0,
				collections: ["col-A", "col-B"],
				content: "content",
				checksum: "xyz",
			};
			const names = new Map([
				["col-A", "Research"],
				["col-B", "Reading"],
			]);
			writeCanonicalFile(dataRoot, doc, names);

			const content = readFileSync(buildCanonicalPath(dataRoot, doc), "utf-8");
			expect(content).toContain('collections: ["Research","Reading"]');
			// Should NOT contain raw IDs
			expect(content).not.toContain("col-A");
		});

		it("escapes newlines in title via JSON.stringify", () => {
			const dataRoot = join(testRoot, "write-title-newline");
			const doc: DocFile = {
				document_id: "nl-doc",
				type: 0,
				collections: [],
				content: "body",
				checksum: "c",
				title: "Line One\nLine Two",
			};
			writeCanonicalFile(dataRoot, doc, emptyCollectionNames);

			const content = readFileSync(buildCanonicalPath(dataRoot, doc), "utf-8");
			expect(content).toContain('title: "Line One\\nLine Two"');
			const dashes = content.match(/^---$/gm);
			expect(dashes).toHaveLength(2);
		});

		it("escapes YAML-special characters in title", () => {
			const dataRoot = join(testRoot, "write-title-yaml");
			const doc: DocFile = {
				document_id: "yaml-doc",
				type: 0,
				collections: [],
				content: "body",
				checksum: "c",
				title: 'Node.js: A Guide [Draft] #1 & "Quoted"',
			};
			writeCanonicalFile(dataRoot, doc, emptyCollectionNames);

			const content = readFileSync(buildCanonicalPath(dataRoot, doc), "utf-8");
			expect(content).toContain(
				'title: "Node.js: A Guide [Draft] #1 & \\"Quoted\\""',
			);
			const dashes = content.match(/^---$/gm);
			expect(dashes).toHaveLength(2);
		});

		it("falls back to collection ID when name is missing", () => {
			const dataRoot = join(testRoot, "write-collections-fallback");
			const doc: DocFile = {
				document_id: "789",
				type: 0,
				collections: ["col-unknown"],
				content: "content",
				checksum: "xyz",
			};
			writeCanonicalFile(dataRoot, doc, emptyCollectionNames);

			const content = readFileSync(buildCanonicalPath(dataRoot, doc), "utf-8");
			expect(content).toContain('collections: ["col-unknown"]');
		});

		it("removeCanonicalFile is safe for nonexistent files", () => {
			const dataRoot = join(testRoot, "remove-safe");
			expect(() =>
				removeCanonicalFile(dataRoot, { type: 0, document_id: "nope" }),
			).not.toThrow();
		});
	});

	describe("buildCollectionHardlink", () => {
		it("creates a hardlink from collections/ to canonical/ (same inode)", () => {
			const dataRoot = join(testRoot, "hardlink-test");

			const doc: DocFile = {
				document_id: "456",
				type: 0,
				collections: ["col-A"],
				content: "content",
				checksum: "xyz",
			};

			writeCanonicalFile(dataRoot, doc, emptyCollectionNames);
			buildCollectionHardlink(dataRoot, doc, "col-A");

			const linkPath = `${dataRoot}/collections/col-A/0/456.md`;
			const canonicalPath = buildCanonicalPath(dataRoot, doc);

			expect(existsSync(linkPath)).toBe(true);
			expect(lstatSync(linkPath).isFile()).toBe(true);
			expect(lstatSync(linkPath).isSymbolicLink()).toBe(false);
			expect(statSync(linkPath).ino).toBe(statSync(canonicalPath).ino);

			expect(readFileSync(linkPath, "utf-8")).toContain("content");
		});

		it("is idempotent — creating the same hardlink twice succeeds", () => {
			const dataRoot = join(testRoot, "hardlink-idempotent");
			const doc: DocFile = {
				document_id: "dup",
				type: 0,
				collections: ["col-X"],
				content: "content",
				checksum: "c1",
			};
			writeCanonicalFile(dataRoot, doc, emptyCollectionNames);
			buildCollectionHardlink(dataRoot, doc, "col-X");
			expect(() =>
				buildCollectionHardlink(dataRoot, doc, "col-X"),
			).not.toThrow();
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

		it("falls back to canonical/ when collection id missing", () => {
			expect(resolveScopeCwd("/data/u1", "collection")).toBe(
				"/data/u1/canonical",
			);
		});
	});

	describe("ephemeral document scope", () => {
		it("creates a hardlink to canonical and removes it cleanly", () => {
			const dataRoot = join(testRoot, "ephemeral-test");
			const doc: DocFile = {
				document_id: "789",
				type: 0,
				collections: [],
				content: "ephemeral",
				checksum: "eph",
			};

			writeCanonicalFile(dataRoot, doc, emptyCollectionNames);

			const scopePath = createEphemeralDocumentScope(dataRoot, "789", doc);
			const linkPath = `${scopePath}/doc.md`;
			const canonicalPath = buildCanonicalPath(dataRoot, doc);

			expect(existsSync(linkPath)).toBe(true);
			expect(lstatSync(linkPath).isFile()).toBe(true);
			expect(lstatSync(linkPath).isSymbolicLink()).toBe(false);
			expect(statSync(linkPath).ino).toBe(statSync(canonicalPath).ino);

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
			writeCanonicalFile(
				dataRoot,
				{
					document_id: "doc-1",
					type: 0,
					collections: [],
					content: "x",
					checksum: "c",
				},
				emptyCollectionNames,
			);
			expect(findCanonicalDoc(dataRoot, "doc-2")).toBeNull();
		});

		it("finds a doc by id in its type directory", () => {
			const dataRoot = join(testRoot, "find-hit");
			writeCanonicalFile(
				dataRoot,
				{
					document_id: "doc-1",
					type: 0,
					collections: [],
					content: "x",
					checksum: "c1",
				},
				emptyCollectionNames,
			);
			writeCanonicalFile(
				dataRoot,
				{
					document_id: "doc-2",
					type: 3,
					collections: [],
					content: "y",
					checksum: "c2",
				},
				emptyCollectionNames,
			);
			expect(findCanonicalDoc(dataRoot, "doc-1")).toEqual({
				document_id: "doc-1",
				type: 0,
			});
			expect(findCanonicalDoc(dataRoot, "doc-2")).toEqual({
				document_id: "doc-2",
				type: 3,
			});
		});

		it("sanitizes the document_id before matching", () => {
			const dataRoot = join(testRoot, "find-sanitize");
			writeCanonicalFile(
				dataRoot,
				{
					document_id: "my doc/id",
					type: 0,
					collections: [],
					content: "x",
					checksum: "c",
				},
				emptyCollectionNames,
			);
			expect(findCanonicalDoc(dataRoot, "my doc/id")).toEqual({
				document_id: "my doc/id",
				type: 0,
			});
		});
	});

	describe("buildCitePath", () => {
		it("builds detail path for non-note types", () => {
			expect(buildCitePath({ document_id: "doc-1", type: 0 })).toBe(
				"detail/0/doc-1",
			);
			expect(buildCitePath({ document_id: "doc-2", type: 6 })).toBe(
				"detail/6/doc-2",
			);
		});

		it("builds notes path for type 3", () => {
			expect(buildCitePath({ document_id: "doc-3", type: 3 })).toBe(
				"notes/3/doc-3",
			);
		});
	});

	describe("writeManifest / readManifest", () => {
		it("round-trips manifest data with entries and collection names", async () => {
			const dataRoot = join(testRoot, "manifest-roundtrip");
			mkdirSync(`${dataRoot}/canonical`, { recursive: true });

			const data = {
				entries: [
					{
						document_id: "doc-1",
						type: 0,
						checksum: "c1",
						collections: ["col-A"],
						title: "My Article",
					},
					{
						document_id: "doc-2",
						type: 3,
						checksum: "c2",
						collections: [],
					},
				],
				collectionNames: { "col-A": "Research" },
			};

			await writeManifest(dataRoot, data);
			const read = await readManifest(dataRoot);
			expect(read).toEqual(data);
		});

		it("returns null when file is missing", async () => {
			const dataRoot = join(testRoot, "manifest-missing");
			expect(await readManifest(dataRoot)).toBeNull();
		});

		it("returns null when file is malformed", async () => {
			const dataRoot = join(testRoot, "manifest-malformed");
			mkdirSync(`${dataRoot}/canonical`, { recursive: true });
			await Bun.write(
				`${dataRoot}/canonical/.manifest.json`,
				"not valid json{",
			);
			expect(await readManifest(dataRoot)).toBeNull();
		});

		it("returns null when file has wrong shape", async () => {
			const dataRoot = join(testRoot, "manifest-wrong-shape");
			mkdirSync(`${dataRoot}/canonical`, { recursive: true });
			await Bun.write(
				`${dataRoot}/canonical/.manifest.json`,
				'{"entries": "not an array"}',
			);
			expect(await readManifest(dataRoot)).toBeNull();
		});
	});

	describe("writeIndexFile", () => {
		it("generates collection-organized index", async () => {
			const dataRoot = join(testRoot, "index-basic");
			mkdirSync(`${dataRoot}/canonical`, { recursive: true });

			const entries = [
				{
					document_id: "doc-1",
					type: 0,
					checksum: "c1",
					collections: ["col-A"],
					title: "My Article",
				},
				{
					document_id: "doc-2",
					type: 3,
					checksum: "c2",
					collections: ["col-A", "col-B"],
					title: "My Note",
				},
			];
			const collectionNames = new Map([
				["col-A", "Research"],
				["col-B", "Reading"],
			]);

			await writeIndexFile(dataRoot, entries, collectionNames);

			const content = readFileSync(
				`${dataRoot}/canonical/_index.md`,
				"utf-8",
			);
			expect(content).toContain("# Collections");
			expect(content).toContain("## Research (col-A)");
			expect(content).toContain("## Reading (col-B)");
			expect(content).toContain("- My Article (0/doc-1.md)");
			expect(content).toContain("- My Note (3/doc-2.md)");
			// No cite column in the new format
			expect(content).not.toContain("detail/0/doc-1");
		});

		it("puts docs without collections under Uncategorized", async () => {
			const dataRoot = join(testRoot, "index-uncategorized");
			mkdirSync(`${dataRoot}/canonical`, { recursive: true });

			await writeIndexFile(
				dataRoot,
				[
					{
						document_id: "doc-1",
						type: 0,
						checksum: "c",
						collections: [],
					},
				],
				new Map(),
			);

			const content = readFileSync(
				`${dataRoot}/canonical/_index.md`,
				"utf-8",
			);
			expect(content).toContain("## Uncategorized");
			expect(content).toContain("- doc-1 (0/doc-1.md)");
		});

		it("falls back to collection ID when name is missing", async () => {
			const dataRoot = join(testRoot, "index-no-col-name");
			mkdirSync(`${dataRoot}/canonical`, { recursive: true });

			await writeIndexFile(
				dataRoot,
				[
					{
						document_id: "doc-1",
						type: 0,
						checksum: "c",
						collections: ["col-unknown"],
					},
				],
				new Map(),
			);

			const content = readFileSync(
				`${dataRoot}/canonical/_index.md`,
				"utf-8",
			);
			expect(content).toContain("## col-unknown (col-unknown)");
		});

		it("sorts collections alphabetically by name", async () => {
			const dataRoot = join(testRoot, "index-sorted");
			mkdirSync(`${dataRoot}/canonical`, { recursive: true });

			const entries = [
				{
					document_id: "doc-1",
					type: 0,
					checksum: "c1",
					collections: ["col-Z"],
					title: "Doc Z",
				},
				{
					document_id: "doc-2",
					type: 0,
					checksum: "c2",
					collections: ["col-A"],
					title: "Doc A",
				},
			];
			const collectionNames = new Map([
				["col-Z", "Zebra"],
				["col-A", "Alpha"],
			]);

			await writeIndexFile(dataRoot, entries, collectionNames);

			const content = readFileSync(
				`${dataRoot}/canonical/_index.md`,
				"utf-8",
			);
			const alphaPos = content.indexOf("## Alpha");
			const zebraPos = content.indexOf("## Zebra");
			expect(alphaPos).toBeGreaterThan(-1);
			expect(zebraPos).toBeGreaterThan(-1);
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
						checksum: "c",
						collections: ["col-A"],
						title: "Title\nWith\nNewlines",
					},
				],
				new Map([["col-A", "Collection\nName"]]),
			);

			const content = readFileSync(
				`${dataRoot}/canonical/_index.md`,
				"utf-8",
			);
			// Newlines should be replaced with spaces, not injecting extra lines
			expect(content).toContain("- Title With Newlines");
			expect(content).toContain("## Collection Name (col-A)");
			expect(content).not.toContain("Title\n");
			expect(content).not.toContain("Collection\n");
		});

		it("generates valid index with no entries", async () => {
			const dataRoot = join(testRoot, "index-empty");
			mkdirSync(`${dataRoot}/canonical`, { recursive: true });

			await writeIndexFile(dataRoot, [], new Map());

			const content = readFileSync(
				`${dataRoot}/canonical/_index.md`,
				"utf-8",
			);
			expect(content).toContain("# Collections");
			expect(content).not.toContain("## Uncategorized");
		});
	});
});
