import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testRoot = join(tmpdir(), `reconcile-test-${Date.now()}`);

const mockGetManifest = mock();
const mockGetFileContents = mock();
const mockGetCollectionNames = mock();

mock.module("./queries", () => ({
	getManifest: mockGetManifest,
	getFileContents: mockGetFileContents,
	getCollectionNames: mockGetCollectionNames,
}));

// Mock getDataRoot to use our test directory
mock.module("./materialization", () => {
	const actual = require("./materialization");
	return {
		...actual,
		getDataRoot: (_userId: string) => join(testRoot, "data"),
	};
});

import {
	buildCollectionHardlink,
	type DocFile,
	readManifest,
	writeCanonicalFile,
	writeManifest,
} from "./materialization";
import { reconcile } from "./reconcile";

describe("reconcile", () => {
	const dataRoot = join(testRoot, "data");
	const emptyCollectionNames = new Map<string, string>();

	beforeEach(() => {
		mockGetManifest.mockReset();
		mockGetFileContents.mockReset();
		mockGetCollectionNames.mockReset();
		mockGetCollectionNames.mockResolvedValue([]);
		rmSync(dataRoot, { recursive: true, force: true });
		mkdirSync(dataRoot, { recursive: true });
	});

	afterAll(() => {
		rmSync(testRoot, { recursive: true, force: true });
		mock.restore();
	});

	it("skips sync when manifest matches remote", async () => {
		// Pre-populate canonical file and manifest
		writeCanonicalFile(
			dataRoot,
			{
				document_id: "doc-1",
				type: 0,
				collections: ["col-A"],
				content: "body",
				checksum: "aaa",
			},
			emptyCollectionNames,
		);
		await writeManifest(dataRoot, [
			{
				document_id: "doc-1",
				type: 0,
				checksum: "aaa",
				collections: ["col-A"],
			},
		]);

		mockGetManifest.mockResolvedValueOnce([
			{
				document_id: "doc-1",
				type: 0,
				checksum: "aaa",
				collections: ["col-A"],
			},
		]);

		const result = await reconcile({ userId: "user-1" });

		expect(result).toBe(false);
		expect(mockGetFileContents).not.toHaveBeenCalled();
	});

	it("removes collection hardlinks and canonical file on delete", async () => {
		const doc: DocFile = {
			document_id: "doc-1",
			type: 0,
			collections: ["col-A"],
			content: "Hello world",
			checksum: "aaa",
		};
		writeCanonicalFile(dataRoot, doc, emptyCollectionNames);
		buildCollectionHardlink(dataRoot, doc, "col-A");
		await writeManifest(dataRoot, [
			{
				document_id: "doc-1",
				type: 0,
				checksum: "aaa",
				collections: ["col-A"],
			},
		]);

		expect(existsSync(`${dataRoot}/canonical/0/doc-1.md`)).toBe(true);
		expect(existsSync(`${dataRoot}/collections/col-A/0/doc-1.md`)).toBe(true);

		mockGetManifest.mockResolvedValueOnce([]);
		mockGetFileContents.mockResolvedValueOnce([]);

		const result = await reconcile({ userId: "user-1" });

		expect(result).toBe(true);
		expect(existsSync(`${dataRoot}/canonical/0/doc-1.md`)).toBe(false);
		expect(existsSync(`${dataRoot}/collections/col-A/0/doc-1.md`)).toBe(false);
	});

	it("creates canonical files and collection hardlinks for new docs", async () => {
		mkdirSync(`${dataRoot}/canonical`, { recursive: true });

		mockGetManifest.mockResolvedValueOnce([
			{
				document_id: "doc-new",
				type: 0,
				checksum: "bbb",
				collections: ["col-B"],
			},
		]);
		mockGetFileContents.mockResolvedValueOnce([
			{
				document_id: "doc-new",
				type: 0,
				checksum: "bbb",
				collections: ["col-B"],
				content: "New document content",
			},
		]);

		const result = await reconcile({ userId: "user-1" });

		expect(result).toBe(true);
		expect(existsSync(`${dataRoot}/canonical/0/doc-new.md`)).toBe(true);
		expect(existsSync(`${dataRoot}/collections/col-B/0/doc-new.md`)).toBe(
			true,
		);

		const content = readFileSync(`${dataRoot}/canonical/0/doc-new.md`, "utf-8");
		expect(content).toContain("New document content");
		expect(content).toContain("title: doc-new");
		expect(content).toContain("cite: detail/0/doc-new");
		// No checksum in frontmatter
		expect(content).not.toContain("checksum:");
	});

	it("updates canonical file when remote checksum changes", async () => {
		writeCanonicalFile(
			dataRoot,
			{
				document_id: "doc-1",
				type: 0,
				collections: [],
				content: "old content",
				checksum: "old",
			},
			emptyCollectionNames,
		);
		await writeManifest(dataRoot, [
			{
				document_id: "doc-1",
				type: 0,
				checksum: "old",
				collections: [],
			},
		]);

		mockGetManifest.mockResolvedValueOnce([
			{
				document_id: "doc-1",
				type: 0,
				checksum: "new",
				collections: [],
			},
		]);
		mockGetFileContents.mockResolvedValueOnce([
			{
				document_id: "doc-1",
				type: 0,
				checksum: "new",
				collections: [],
				content: "new content",
			},
		]);

		const result = await reconcile({ userId: "user-1" });

		expect(result).toBe(true);
		expect(mockGetFileContents).toHaveBeenCalledTimes(1);

		const onDisk = readFileSync(`${dataRoot}/canonical/0/doc-1.md`, "utf-8");
		expect(onDisk).toContain("new content");
	});

	it("writes .manifest.json after sync", async () => {
		mkdirSync(`${dataRoot}/canonical`, { recursive: true });

		const remote = [
			{
				document_id: "doc-1",
				type: 0,
				checksum: "c1",
				collections: [],
			},
			{
				document_id: "doc-2",
				type: 3,
				checksum: "c2",
				collections: ["col-X"],
			},
		];
		mockGetManifest.mockResolvedValueOnce(remote);
		mockGetFileContents.mockResolvedValueOnce(
			remote.map((r) => ({ ...r, content: `content of ${r.document_id}` })),
		);

		await reconcile({ userId: "user-1" });

		// Manifest should be persisted
		const manifest = await readManifest(dataRoot);
		expect(manifest).toEqual(remote);
	});

	it("generates _index.md on every reconcile", async () => {
		mkdirSync(`${dataRoot}/canonical`, { recursive: true });

		mockGetManifest.mockResolvedValueOnce([
			{
				document_id: "doc-1",
				type: 0,
				checksum: "c1",
				collections: ["col-A"],
				title: "My Article",
			},
		]);
		mockGetFileContents.mockResolvedValueOnce([
			{
				document_id: "doc-1",
				type: 0,
				checksum: "c1",
				collections: ["col-A"],
				content: "content",
				title: "My Article",
			},
		]);
		mockGetCollectionNames.mockResolvedValueOnce([
			{ collection_id: "col-A", name: "Research" },
		]);

		await reconcile({ userId: "user-1" });

		const indexContent = readFileSync(
			`${dataRoot}/canonical/_index.md`,
			"utf-8",
		);
		expect(indexContent).toContain("# Collections");
		expect(indexContent).toContain("My Article");
		expect(indexContent).toContain("Research");
	});

	it("skips _index.md regeneration when manifest is unchanged", async () => {
		writeCanonicalFile(
			dataRoot,
			{
				document_id: "doc-1",
				type: 0,
				collections: [],
				content: "body",
				checksum: "aaa",
			},
			emptyCollectionNames,
		);
		await writeManifest(dataRoot, [
			{
				document_id: "doc-1",
				type: 0,
				checksum: "aaa",
				collections: [],
			},
		]);

		mockGetManifest.mockResolvedValueOnce([
			{
				document_id: "doc-1",
				type: 0,
				checksum: "aaa",
				collections: [],
			},
		]);
		mockGetCollectionNames.mockResolvedValueOnce([]);

		const result = await reconcile({ userId: "user-1" });
		expect(result).toBe(false);

		// No _index.md generated on the fast path (no changes)
		expect(existsSync(`${dataRoot}/canonical/_index.md`)).toBe(false);
	});

	it("writes human-readable collection names in frontmatter", async () => {
		mkdirSync(`${dataRoot}/canonical`, { recursive: true });

		mockGetManifest.mockResolvedValueOnce([
			{
				document_id: "doc-1",
				type: 0,
				checksum: "c1",
				collections: ["col-A"],
				title: "My Article",
			},
		]);
		mockGetFileContents.mockResolvedValueOnce([
			{
				document_id: "doc-1",
				type: 0,
				checksum: "c1",
				collections: ["col-A"],
				content: "content",
				title: "My Article",
			},
		]);
		mockGetCollectionNames.mockResolvedValueOnce([
			{ collection_id: "col-A", name: "Research" },
		]);

		await reconcile({ userId: "user-1" });

		const content = readFileSync(`${dataRoot}/canonical/0/doc-1.md`, "utf-8");
		expect(content).toContain('collections: ["Research"]');
		expect(content).not.toContain("col-A");
	});
});
