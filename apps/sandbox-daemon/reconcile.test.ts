import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testRoot = join(tmpdir(), `reconcile-test-${Date.now()}`);

const mockGetStateVersion = mock();
const mockGetManifest = mock();
const mockGetFileContents = mock();

mock.module("./queries", () => ({
	getStateVersion: mockGetStateVersion,
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
import {
	readSyncedVersion,
	writeLocalManifest,
	writeSyncedVersion,
} from "./state";

describe("reconcile", () => {
	const dataRoot = join(testRoot, "data");

	beforeEach(() => {
		mockGetStateVersion.mockReset();
		mockGetManifest.mockReset();
		mockGetFileContents.mockReset();
		rmSync(dataRoot, { recursive: true, force: true });
		mkdirSync(dataRoot, { recursive: true });
	});

	afterAll(() => {
		rmSync(testRoot, { recursive: true, force: true });
		mock.restore();
	});

	it("skips sync when local version >= DB version", async () => {
		writeSyncedVersion(dataRoot, 5);

		mockGetStateVersion.mockResolvedValueOnce(5);

		const result = await reconcile({ userId: "user-1" });

		expect(result).toBe(false);
		expect(mockGetManifest).not.toHaveBeenCalled();
	});

	it("removes collection symlinks and rebuilds indexes on delete", async () => {
		writeSyncedVersion(dataRoot, 0);

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

		mockGetStateVersion.mockResolvedValueOnce(1);
		mockGetManifest.mockResolvedValueOnce([]);
		mockGetFileContents.mockResolvedValueOnce([]);

		const result = await reconcile({ userId: "user-1" });

		expect(result).toBe(true);
		expect(existsSync(`${dataRoot}/canonical/0/doc-1.md`)).toBe(false);
		expect(existsSync(`${dataRoot}/collections/col-A/0/doc-1.md`)).toBe(false);
	});

	it("creates canonical files and collection symlinks for new docs", async () => {
		writeSyncedVersion(dataRoot, 0);
		writeLocalManifest(dataRoot, []);

		mockGetStateVersion.mockResolvedValueOnce(1);
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

	it("updates synced version after sync", async () => {
		writeSyncedVersion(dataRoot, 0);
		writeLocalManifest(dataRoot, []);

		mockGetStateVersion.mockResolvedValueOnce(42);
		mockGetManifest.mockResolvedValueOnce([]);
		mockGetFileContents.mockResolvedValueOnce([]);

		await reconcile({ userId: "user-1" });

		expect(readSyncedVersion(dataRoot)).toBe(42);
	});
});
