import { describe, expect, it, afterAll } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	sanitizePathSegment,
	computeChecksum,
	getDataRoot,
	buildCanonicalPath,
	writeCanonicalFile,
	removeCanonicalFile,
	buildCollectionSymlink,
	buildCollectionIndex,
	buildScopeRoots,
	createEphemeralDocumentScope,
	removeEphemeralDocumentScope,
	resolveScopeCwd,
	type DocFile,
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

		it("two docs with same slug but different IDs get distinct paths", () => {
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
				slug: "test-doc",
				path_key: "",
				content: "Hello world",
				checksum: "abc",
			};

			writeCanonicalFile(dataRoot, doc);

			const filePath = buildCanonicalPath(dataRoot, doc);
			expect(existsSync(filePath)).toBe(true);

			const content = readFileSync(filePath, "utf-8");
			expect(content).toContain("summaryId: 123");
			expect(content).toContain("type: 0");
			expect(content).toContain("Hello world");

			removeCanonicalFile(dataRoot, doc);
			expect(existsSync(filePath)).toBe(false);
		});

		it("removeCanonicalFile is safe for nonexistent files", () => {
			const dataRoot = join(testRoot, "remove-safe");
			expect(() =>
				removeCanonicalFile(dataRoot, { type: 0, document_id: "nope" }),
			).not.toThrow();
		});
	});

	describe("buildCollectionSymlink", () => {
		it("creates a symlink from collections/ to canonical/", () => {
			const dataRoot = join(testRoot, "symlink-test");

			const doc: DocFile = {
				document_id: "456",
				type: 0,
				slug: "linked-doc",
				path_key: "",
				content: "content",
				checksum: "xyz",
			};

			writeCanonicalFile(dataRoot, doc);
			buildCollectionSymlink(dataRoot, doc, "col-A");

			// Path uses document_id, not slug
			const linkPath = `${dataRoot}/collections/col-A/0/456.md`;
			expect(existsSync(linkPath)).toBe(true);

			const target = readlinkSync(linkPath);
			expect(target).toContain("canonical");
		});
	});

	describe("buildCollectionIndex", () => {
		it("writes a markdown index file with document_id-based links", () => {
			const dataRoot = join(testRoot, "index-test");

			buildCollectionIndex(dataRoot, "col-X", [
				{ document_id: "1", type: 0, slug: "doc-one" },
				{ document_id: "2", type: 3, slug: "note-two" },
			]);

			const indexPath = `${dataRoot}/indexes/collections/col-X.md`;
			expect(existsSync(indexPath)).toBe(true);

			const content = readFileSync(indexPath, "utf-8");
			expect(content).toContain("# Collection: col-X");
			// Display name is slug, link path uses document_id
			expect(content).toContain("[doc-one]");
			expect(content).toContain("/1.md");
			expect(content).toContain("[note-two]");
			expect(content).toContain("/2.md");
		});
	});

	describe("buildScopeRoots", () => {
		it("creates global and collection scope symlinks", () => {
			const dataRoot = join(testRoot, "scopes-test");
			mkdirSync(`${dataRoot}/canonical`, { recursive: true });
			mkdirSync(`${dataRoot}/indexes/collections`, { recursive: true });
			mkdirSync(`${dataRoot}/collections/col-1`, { recursive: true });

			buildScopeRoots(dataRoot, ["col-1"]);

			expect(existsSync(`${dataRoot}/scopes/global/docs`)).toBe(true);
			expect(existsSync(`${dataRoot}/scopes/global/collections`)).toBe(true);
			expect(existsSync(`${dataRoot}/scopes/collection-col-1/docs`)).toBe(
				true,
			);
		});

		it("cleans up stale collection scopes", () => {
			const dataRoot = join(testRoot, "scopes-cleanup");
			mkdirSync(`${dataRoot}/canonical`, { recursive: true });
			mkdirSync(`${dataRoot}/indexes/collections`, { recursive: true });
			mkdirSync(`${dataRoot}/collections/col-old`, { recursive: true });

			buildScopeRoots(dataRoot, ["col-old"]);
			expect(
				existsSync(`${dataRoot}/scopes/collection-col-old`),
			).toBe(true);

			buildScopeRoots(dataRoot, []);
			expect(
				existsSync(`${dataRoot}/scopes/collection-col-old`),
			).toBe(false);
			expect(existsSync(`${dataRoot}/scopes/global`)).toBe(true);
		});
	});

	describe("ephemeral document scope", () => {
		it("creates and removes a single-doc scope", () => {
			const dataRoot = join(testRoot, "ephemeral-test");
			const doc: DocFile = {
				document_id: "789",
				type: 0,
				slug: "eph-doc",
				path_key: "",
				content: "ephemeral",
				checksum: "eph",
			};

			writeCanonicalFile(dataRoot, doc);

			const scopePath = createEphemeralDocumentScope(
				dataRoot,
				"789",
				doc,
			);
			expect(existsSync(`${scopePath}/doc.md`)).toBe(true);

			removeEphemeralDocumentScope(dataRoot, "789");
			expect(existsSync(scopePath)).toBe(false);
		});
	});

	describe("resolveScopeCwd", () => {
		it("resolves global scope", () => {
			expect(resolveScopeCwd("/data/u1", "global")).toBe(
				"/data/u1/scopes/global",
			);
		});

		it("resolves collection scope", () => {
			expect(resolveScopeCwd("/data/u1", "collection", "col-1")).toBe(
				"/data/u1/scopes/collection-col-1",
			);
		});

		it("resolves document scope", () => {
			expect(resolveScopeCwd("/data/u1", "document", "doc-1")).toBe(
				"/data/u1/scopes/request-doc-1",
			);
		});

		it("falls back to global when scopeId missing", () => {
			expect(resolveScopeCwd("/data/u1", "collection")).toBe(
				"/data/u1/scopes/global",
			);
		});
	});
});
