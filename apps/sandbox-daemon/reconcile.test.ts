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
	buildCollectionIndex,
	buildCollectionSymlink,
	type DocFile,
	writeCanonicalFile,
} from "./materialization";
import { reconcile } from "./reconcile";
import { readLocalManifest, writeLocalManifest } from "./state";

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

	it("skips sync when local manifest equals remote manifest", async () => {
		const entry = {
			document_id: "doc-1",
			type: 0,
			slug: "my-doc",
			path_key: "col-A",
			checksum: "aaa",
		};
		writeLocalManifest(dataRoot, [entry]);
		mockGetManifest.mockResolvedValueOnce([entry]);

		const result = await reconcile({ userId: "user-1" });

		expect(result).toBe(false);
		expect(mockGetFileContents).not.toHaveBeenCalled();
	});

	it("removes collection symlinks and rebuilds indexes on delete", async () => {
		const doc: DocFile = {
			document_id: "doc-1",
			type: 0,
			slug: "my-doc",
			path_key: "col-A",
			content: "Hello world",
			checksum: "aaa",
		};
		writeCanonicalFile(dataRoot, doc);
		buildCollectionSymlink(dataRoot, doc, "col-A");
		buildCollectionIndex(dataRoot, "col-A", [
			{ document_id: "doc-1", type: 0, slug: "my-doc" },
		]);

		writeLocalManifest(dataRoot, [
			{
				document_id: "doc-1",
				type: 0,
				slug: "my-doc",
				path_key: "col-A",
				checksum: "aaa",
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

	it("creates canonical files and collection symlinks for new docs", async () => {
		writeLocalManifest(dataRoot, []);

		mockGetManifest.mockResolvedValueOnce([
			{
				document_id: "doc-new",
				type: 0,
				slug: "new-doc",
				path_key: "col-B",
				checksum: "bbb",
			},
		]);
		mockGetFileContents.mockResolvedValueOnce([
			{
				document_id: "doc-new",
				type: 0,
				slug: "new-doc",
				path_key: "col-B",
				content: "New document content",
				checksum: "bbb",
			},
		]);

		const result = await reconcile({ userId: "user-1" });

		expect(result).toBe(true);
		expect(existsSync(`${dataRoot}/canonical/0/doc-new.md`)).toBe(true);
		expect(existsSync(`${dataRoot}/collections/col-B/0/doc-new.md`)).toBe(true);

		const content = readFileSync(`${dataRoot}/canonical/0/doc-new.md`, "utf-8");
		expect(content).toContain("New document content");
	});

	it("rewrites local manifest after sync", async () => {
		writeLocalManifest(dataRoot, []);

		const remote = [
			{
				document_id: "doc-1",
				type: 0,
				slug: "d1",
				path_key: "",
				checksum: "c1",
			},
			{
				document_id: "doc-2",
				type: 3,
				slug: "d2",
				path_key: "col-X",
				checksum: "c2",
			},
		];
		mockGetManifest.mockResolvedValueOnce(remote);
		mockGetFileContents.mockResolvedValueOnce(
			remote.map((r) => ({ ...r, content: `content of ${r.document_id}` })),
		);

		await reconcile({ userId: "user-1" });

		expect(readLocalManifest(dataRoot)).toEqual(remote);
	});
});
