import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testRoot = join(tmpdir(), `reconcile-test-${Date.now()}`);

const mockGetManifest = mock();
const mockGetFileContents = mock();

mock.module("./queries", () => ({
	getManifest: mockGetManifest,
	getFileContents: mockGetFileContents,
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
	deriveLocalManifest,
	writeCanonicalFile,
} from "./materialization";
import { reconcile } from "./reconcile";

describe("reconcile", () => {
	const dataRoot = join(testRoot, "data");

	beforeEach(() => {
		mockGetManifest.mockReset();
		mockGetFileContents.mockReset();
		rmSync(dataRoot, { recursive: true, force: true });
		mkdirSync(dataRoot, { recursive: true });
	});

	afterAll(() => {
		rmSync(testRoot, { recursive: true, force: true });
		mock.restore();
	});

	it("skips sync when derived local manifest equals remote manifest", async () => {
		// Pre-populate canonical file so deriveLocalManifest returns a matching entry.
		writeCanonicalFile(dataRoot, {
			document_id: "doc-1",
			type: 0,
			collections: ["col-A"],
			content: "body",
			checksum: "aaa",
		});

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
		writeCanonicalFile(dataRoot, doc);
		buildCollectionHardlink(dataRoot, doc, "col-A");

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
		// Start with empty canonical/.
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
		expect(existsSync(`${dataRoot}/collections/col-B/0/doc-new.md`)).toBe(true);

		const content = readFileSync(`${dataRoot}/canonical/0/doc-new.md`, "utf-8");
		expect(content).toContain("New document content");
		expect(content).toContain("checksum: bbb");
		expect(content).toContain('collections: ["col-B"]');
	});

	it("updates canonical file when remote checksum changes", async () => {
		writeCanonicalFile(dataRoot, {
			document_id: "doc-1",
			type: 0,
			collections: [],
			content: "old content",
			checksum: "old",
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
		expect(mockGetFileContents).toHaveBeenCalledTimes(1);

		const onDisk = readFileSync(`${dataRoot}/canonical/0/doc-1.md`, "utf-8");
		expect(onDisk).toContain("new content");
		expect(onDisk).toContain("checksum: new");
	});

	it("derives local manifest from canonical frontmatter after sync", async () => {
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

		expect(await deriveLocalManifest(dataRoot)).toEqual(remote);
	});
});
