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
	buildCollectionHardlink,
	computeChecksum,
	createEphemeralDocumentScope,
	type DocFile,
	deriveLocalManifest,
	getDataRoot,
	parseCollectionIds,
	parseFrontmatter,
	removeCanonicalFile,
	removeEphemeralDocumentScope,
	resolveScopeCwd,
	sanitizePathSegment,
	writeCanonicalFile,
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
		it("writes file with frontmatter and removes it", () => {
			const dataRoot = join(testRoot, "write-test");

			const doc: DocFile = {
				document_id: "123",
				type: 0,
				collections: [],
				content: "Hello world",
				checksum: "abc",
			};

			writeCanonicalFile(dataRoot, doc);

			const filePath = buildCanonicalPath(dataRoot, doc);
			expect(existsSync(filePath)).toBe(true);

			const content = readFileSync(filePath, "utf-8");
			expect(content).toContain("summaryId: 123");
			expect(content).toContain("type: 0");
			expect(content).toContain("checksum: abc");
			// Empty collections → no collections line
			expect(content).not.toContain("collections:");
			expect(content).toContain("Hello world");

			removeCanonicalFile(dataRoot, doc);
			expect(existsSync(filePath)).toBe(false);
		});

		it("emits collections line as JSON array when non-empty", () => {
			const dataRoot = join(testRoot, "write-collections-test");
			const doc: DocFile = {
				document_id: "456",
				type: 0,
				collections: ["col-A", "col-B"],
				content: "content",
				checksum: "xyz",
			};
			writeCanonicalFile(dataRoot, doc);

			const content = readFileSync(buildCanonicalPath(dataRoot, doc), "utf-8");
			expect(content).toContain('collections: ["col-A","col-B"]');
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

			writeCanonicalFile(dataRoot, doc);
			buildCollectionHardlink(dataRoot, doc, "col-A");

			const linkPath = `${dataRoot}/collections/col-A/0/456.md`;
			const canonicalPath = buildCanonicalPath(dataRoot, doc);

			expect(existsSync(linkPath)).toBe(true);
			// lstatSync without auto-following: must be a regular file, not a symlink
			expect(lstatSync(linkPath).isFile()).toBe(true);
			expect(lstatSync(linkPath).isSymbolicLink()).toBe(false);
			// Same inode as the canonical file — proves the hardlink is sharing bytes
			expect(statSync(linkPath).ino).toBe(statSync(canonicalPath).ino);

			// Content round-trip via the hardlink path
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
			writeCanonicalFile(dataRoot, doc);
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

			writeCanonicalFile(dataRoot, doc);

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

	describe("parseFrontmatter", () => {
		it("parses a well-formed frontmatter", () => {
			const dataRoot = join(testRoot, "parse-good");
			const doc: DocFile = {
				document_id: "doc-1",
				type: 0,
				collections: ["col-A", "col-B"],
				content: "body",
				checksum: "abc",
			};
			writeCanonicalFile(dataRoot, doc);
			const path = buildCanonicalPath(dataRoot, doc);

			const entry = parseFrontmatter(path);
			expect(entry).toEqual({
				document_id: "doc-1",
				type: 0,
				checksum: "abc",
				collections: ["col-A", "col-B"],
			});
		});

		it("returns empty collections when the line is absent", () => {
			const dataRoot = join(testRoot, "parse-nocols");
			const doc: DocFile = {
				document_id: "doc-2",
				type: 3,
				collections: [],
				content: "body",
				checksum: "xyz",
			};
			writeCanonicalFile(dataRoot, doc);
			const path = buildCanonicalPath(dataRoot, doc);

			const entry = parseFrontmatter(path);
			expect(entry).toEqual({
				document_id: "doc-2",
				type: 3,
				checksum: "xyz",
				collections: [],
			});
		});

		it("returns null for a file without frontmatter", () => {
			const dataRoot = join(testRoot, "parse-nofm");
			mkdirSync(dataRoot, { recursive: true });
			const path = join(dataRoot, "bad.md");
			writeFileSync(path, "no frontmatter here\njust body\n", "utf-8");
			expect(parseFrontmatter(path)).toBeNull();
		});

		it("returns null when required fields are missing", () => {
			const dataRoot = join(testRoot, "parse-incomplete");
			mkdirSync(dataRoot, { recursive: true });
			const path = join(dataRoot, "incomplete.md");
			writeFileSync(path, "---\nsummaryId: x\ntype: 0\n---\n\nbody\n", "utf-8");
			// Missing checksum — parser should reject
			expect(parseFrontmatter(path)).toBeNull();
		});

		it("returns null when collections JSON is malformed", () => {
			const dataRoot = join(testRoot, "parse-bad-cols");
			mkdirSync(dataRoot, { recursive: true });
			const path = join(dataRoot, "bad-cols.md");
			// Brackets present so the line matches, but the JSON itself is invalid.
			writeFileSync(
				path,
				"---\nsummaryId: x\ntype: 0\nchecksum: c\ncollections: [bad]\n---\n\nbody\n",
				"utf-8",
			);
			expect(parseFrontmatter(path)).toBeNull();
		});

		it("returns null when collections JSON is an array of non-strings", () => {
			const dataRoot = join(testRoot, "parse-bad-cols-type");
			mkdirSync(dataRoot, { recursive: true });
			const path = join(dataRoot, "bad-cols-type.md");
			writeFileSync(
				path,
				"---\nsummaryId: x\ntype: 0\nchecksum: c\ncollections: [1,2,3]\n---\n\nbody\n",
				"utf-8",
			);
			expect(parseFrontmatter(path)).toBeNull();
		});
	});

	describe("deriveLocalManifest", () => {
		it("returns empty array when canonical/ is missing", () => {
			const dataRoot = join(testRoot, "derive-empty-noroot");
			expect(deriveLocalManifest(dataRoot)).toEqual([]);
		});

		it("returns empty array when canonical/ exists but is empty", () => {
			const dataRoot = join(testRoot, "derive-empty-root");
			mkdirSync(`${dataRoot}/canonical`, { recursive: true });
			expect(deriveLocalManifest(dataRoot)).toEqual([]);
		});

		it("returns entries sorted by document_id across type dirs", () => {
			const dataRoot = join(testRoot, "derive-sorted");
			writeCanonicalFile(dataRoot, {
				document_id: "b-doc",
				type: 0,
				collections: [],
				content: "x",
				checksum: "c1",
			});
			writeCanonicalFile(dataRoot, {
				document_id: "a-doc",
				type: 3,
				collections: ["col-1"],
				content: "y",
				checksum: "c2",
			});

			const entries = deriveLocalManifest(dataRoot);
			expect(entries).toEqual([
				{
					document_id: "a-doc",
					type: 3,
					checksum: "c2",
					collections: ["col-1"],
				},
				{
					document_id: "b-doc",
					type: 0,
					checksum: "c1",
					collections: [],
				},
			]);
		});

		it("skips non-numeric type dirs", () => {
			const dataRoot = join(testRoot, "derive-non-numeric");
			mkdirSync(`${dataRoot}/canonical/notanumber`, { recursive: true });
			writeFileSync(
				`${dataRoot}/canonical/notanumber/ghost.md`,
				"---\nsummaryId: ghost\ntype: 0\nchecksum: g\n---\n\n",
				"utf-8",
			);
			expect(deriveLocalManifest(dataRoot)).toEqual([]);
		});

		it("skips non-.md files", () => {
			const dataRoot = join(testRoot, "derive-non-md");
			mkdirSync(`${dataRoot}/canonical/0`, { recursive: true });
			writeFileSync(
				`${dataRoot}/canonical/0/notes.txt`,
				"---\nsummaryId: x\ntype: 0\nchecksum: c\n---\n\n",
				"utf-8",
			);
			expect(deriveLocalManifest(dataRoot)).toEqual([]);
		});

		it("skips files with malformed frontmatter and logs a warning", () => {
			const dataRoot = join(testRoot, "derive-malformed");
			mkdirSync(`${dataRoot}/canonical/0`, { recursive: true });
			writeFileSync(
				`${dataRoot}/canonical/0/bad.md`,
				"no frontmatter",
				"utf-8",
			);
			writeCanonicalFile(dataRoot, {
				document_id: "good",
				type: 0,
				collections: [],
				content: "body",
				checksum: "c",
			});

			const warnings: Array<Record<string, unknown>> = [];
			const entries = deriveLocalManifest(dataRoot, {
				warn: (m) => {
					warnings.push(m);
				},
			});

			expect(entries.map((e) => e.document_id)).toEqual(["good"]);
			expect(warnings).toHaveLength(1);
			expect(String(warnings[0]?.path)).toContain("bad.md");
		});
	});
});
