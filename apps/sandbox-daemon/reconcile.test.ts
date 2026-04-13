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

	it("skips sync when manifest and collection names match remote", async () => {
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
		await writeManifest(dataRoot, {
			entries: [
				{
					document_id: "doc-1",
					type: 0,
					checksum: "aaa",
					collections: ["col-A"],
				},
			],
			collectionNames: { "col-A": "Research" },
		});

		mockGetManifest.mockResolvedValueOnce([
			{
				document_id: "doc-1",
				type: 0,
				checksum: "aaa",
				collections: ["col-A"],
			},
		]);
		mockGetCollectionNames.mockResolvedValueOnce([
			{ collection_id: "col-A", name: "Research" },
		]);

		const result = await reconcile({ userId: "user-1" });

		expect(result).toBe(false);
		expect(mockGetFileContents).not.toHaveBeenCalled();
	});

	it("cleans up orphaned files when manifest is missing", async () => {
		// Write a file directly without a manifest (simulates first rollout or corrupt manifest)
		writeCanonicalFile(
			dataRoot,
			{
				document_id: "orphan",
				type: 0,
				collections: [],
				content: "stale content",
				checksum: "old",
			},
			emptyCollectionNames,
		);
		expect(existsSync(`${dataRoot}/canonical/0/orphan.md`)).toBe(true);

		// Remote says no documents exist (doc was deleted from DB)
		mockGetManifest.mockResolvedValueOnce([]);
		mockGetFileContents.mockResolvedValueOnce([]);

		await reconcile({ userId: "user-1" });

		// Orphaned file should be gone — clearDataRoot wiped the workspace
		expect(existsSync(`${dataRoot}/canonical/0/orphan.md`)).toBe(false);
	});

	it("cleans up orphaned files when manifest is corrupt", async () => {
		writeCanonicalFile(
			dataRoot,
			{
				document_id: "orphan",
				type: 0,
				collections: [],
				content: "stale content",
				checksum: "old",
			},
			emptyCollectionNames,
		);
		// Write corrupt manifest (file exists but invalid JSON)
		mkdirSync(`${dataRoot}/canonical`, { recursive: true });
		const { writeFileSync } = require("node:fs");
		writeFileSync(
			`${dataRoot}/canonical/.manifest.json`,
			"truncated{",
			"utf-8",
		);

		expect(existsSync(`${dataRoot}/canonical/0/orphan.md`)).toBe(true);

		mockGetManifest.mockResolvedValueOnce([]);
		mockGetFileContents.mockResolvedValueOnce([]);

		await reconcile({ userId: "user-1" });

		expect(existsSync(`${dataRoot}/canonical/0/orphan.md`)).toBe(false);
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
		await writeManifest(dataRoot, {
			entries: [
				{
					document_id: "doc-1",
					type: 0,
					checksum: "aaa",
					collections: ["col-A"],
				},
			],
			collectionNames: {},
		});

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
		expect(content).toContain('title: "doc-new"');
		expect(content).toContain("cite: detail/0/doc-new");
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
		await writeManifest(dataRoot, {
			entries: [
				{
					document_id: "doc-1",
					type: 0,
					checksum: "old",
					collections: [],
				},
			],
			collectionNames: {},
		});

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
		const onDisk = readFileSync(`${dataRoot}/canonical/0/doc-1.md`, "utf-8");
		expect(onDisk).toContain("new content");
	});

	it("updates canonical file when title changes but checksum is unchanged", async () => {
		writeCanonicalFile(
			dataRoot,
			{
				document_id: "doc-1",
				type: 0,
				collections: [],
				content: "content",
				checksum: "same",
				title: "Old Title",
			},
			emptyCollectionNames,
		);
		await writeManifest(dataRoot, {
			entries: [
				{
					document_id: "doc-1",
					type: 0,
					checksum: "same",
					collections: [],
					title: "Old Title",
				},
			],
			collectionNames: {},
		});

		mockGetManifest.mockResolvedValueOnce([
			{
				document_id: "doc-1",
				type: 0,
				checksum: "same",
				collections: [],
				title: "New Title",
			},
		]);
		mockGetFileContents.mockResolvedValueOnce([
			{
				document_id: "doc-1",
				type: 0,
				checksum: "same",
				collections: [],
				content: "content",
				title: "New Title",
			},
		]);

		const result = await reconcile({ userId: "user-1" });

		expect(result).toBe(true);
		const onDisk = readFileSync(`${dataRoot}/canonical/0/doc-1.md`, "utf-8");
		expect(onDisk).toContain('title: "New Title"');
	});

	it("writes .manifest.json with entries and collectionNames after sync", async () => {
		mkdirSync(`${dataRoot}/canonical`, { recursive: true });

		const remote = [
			{
				document_id: "doc-1",
				type: 0,
				checksum: "c1",
				collections: ["col-X"],
			},
		];
		mockGetManifest.mockResolvedValueOnce(remote);
		mockGetFileContents.mockResolvedValueOnce(
			remote.map((r) => ({ ...r, content: "body" })),
		);
		mockGetCollectionNames.mockResolvedValueOnce([
			{ collection_id: "col-X", name: "Research" },
		]);

		await reconcile({ userId: "user-1" });

		const manifest = await readManifest(dataRoot);
		expect(manifest.entries).toEqual(remote);
		expect(manifest.collectionNames).toEqual({ "col-X": "Research" });
	});

	it("generates _index.md on sync", async () => {
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

	it("skips _index.md when nothing changed", async () => {
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
		await writeManifest(dataRoot, {
			entries: [
				{
					document_id: "doc-1",
					type: 0,
					checksum: "aaa",
					collections: [],
				},
			],
			collectionNames: {},
		});

		mockGetManifest.mockResolvedValueOnce([
			{
				document_id: "doc-1",
				type: 0,
				checksum: "aaa",
				collections: [],
			},
		]);

		const result = await reconcile({ userId: "user-1" });
		expect(result).toBe(false);
		expect(existsSync(`${dataRoot}/canonical/_index.md`)).toBe(false);
	});

	it("rewrites frontmatter and _index.md when collection is renamed", async () => {
		writeCanonicalFile(
			dataRoot,
			{
				document_id: "doc-1",
				type: 0,
				collections: ["col-A"],
				content: "content",
				checksum: "c1",
				title: "My Article",
			},
			new Map([["col-A", "Old Name"]]),
		);
		await writeManifest(dataRoot, {
			entries: [
				{
					document_id: "doc-1",
					type: 0,
					checksum: "c1",
					collections: ["col-A"],
					title: "My Article",
				},
			],
			collectionNames: { "col-A": "Old Name" },
		});

		// Same document manifest, but collection renamed
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
			{ collection_id: "col-A", name: "New Name" },
		]);

		const result = await reconcile({ userId: "user-1" });

		expect(result).toBe(true);

		// Frontmatter should have new collection name
		const content = readFileSync(`${dataRoot}/canonical/0/doc-1.md`, "utf-8");
		expect(content).toContain('collections: ["New Name"]');
		expect(content).not.toContain("Old Name");

		// _index.md should have new collection name
		const indexContent = readFileSync(
			`${dataRoot}/canonical/_index.md`,
			"utf-8",
		);
		expect(indexContent).toContain("New Name");
		expect(indexContent).not.toContain("Old Name");

		// Manifest should store updated names
		const manifest = await readManifest(dataRoot);
		expect(manifest.collectionNames).toEqual({ "col-A": "New Name" });
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
