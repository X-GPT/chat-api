import { describe, expect, it, afterAll, mock, beforeEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testRoot = join(tmpdir(), `reconcile-test-${Date.now()}`);

// Mock the db module to avoid needing a real Postgres
const mockQuery = mock();
mock.module("./db", () => ({
	getPool: () => ({ query: mockQuery }),
}));

// Mock getDataRoot to use our test directory
mock.module("./materialization", () => {
	const actual = require("./materialization");
	return {
		...actual,
		getDataRoot: (_userId: string) => join(testRoot, "data"),
	};
});

import { reconcile } from "./reconcile";
import {
	writeCanonicalFile,
	buildCollectionSymlink,
	buildCollectionIndex,
	type DocFile,
} from "./materialization";
import { writeLocalManifest, writeSyncedVersion, readSyncedVersion } from "./state";

describe("reconcile", () => {
	const dataRoot = join(testRoot, "data");

	beforeEach(() => {
		mockQuery.mockReset();
		rmSync(dataRoot, { recursive: true, force: true });
		mkdirSync(dataRoot, { recursive: true });
	});

	afterAll(() => {
		rmSync(testRoot, { recursive: true, force: true });
		mock.restore();
	});

	it("skips sync when local version >= required version", async () => {
		writeSyncedVersion(dataRoot, 5);

		const result = await reconcile({
			userId: "user-1",
			requiredVersion: 5,
					});

		expect(result).toBe(false);
		expect(mockQuery).not.toHaveBeenCalled();
	});

	it("removes collection symlinks and rebuilds indexes on delete", async () => {
		writeSyncedVersion(dataRoot, 0);

		// Set up existing files: one doc in collection "col-A"
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

		// Verify files exist before reconcile
		expect(existsSync(`${dataRoot}/canonical/0/doc-1.md`)).toBe(true);
		expect(existsSync(`${dataRoot}/collections/col-A/0/doc-1.md`)).toBe(true);

		// Remote manifest returns empty → doc was deleted
		mockQuery.mockResolvedValueOnce({ rows: [] });

		const result = await reconcile({
			userId: "user-1",
			requiredVersion: 1,
					});

		expect(result).toBe(true);

		// Canonical file should be removed
		expect(existsSync(`${dataRoot}/canonical/0/doc-1.md`)).toBe(false);

		// Collection symlink should be removed
		expect(existsSync(`${dataRoot}/collections/col-A/0/doc-1.md`)).toBe(false);
	});

	it("creates canonical files and collection symlinks for new docs", async () => {
		writeSyncedVersion(dataRoot, 0);
		writeLocalManifest(dataRoot, []);

		// Manifest query: one new doc
		mockQuery.mockResolvedValueOnce({
			rows: [
				{
					document_id: "doc-new",
					type: 0,
					slug: "new-doc",
					path_key: "col-B",
					checksum: "bbb",
				},
			],
		});
		// Content query: full doc
		mockQuery.mockResolvedValueOnce({
			rows: [
				{
					document_id: "doc-new",
					type: 0,
					slug: "new-doc",
					path_key: "col-B",
					content: "New document content",
					checksum: "bbb",
				},
			],
		});

		const result = await reconcile({
			userId: "user-1",
			requiredVersion: 1,
					});

		expect(result).toBe(true);
		expect(existsSync(`${dataRoot}/canonical/0/doc-new.md`)).toBe(true);
		expect(existsSync(`${dataRoot}/collections/col-B/0/doc-new.md`)).toBe(true);

		const content = readFileSync(`${dataRoot}/canonical/0/doc-new.md`, "utf-8");
		expect(content).toContain("New document content");
	});

	it("updates synced version after sync", async () => {
		writeSyncedVersion(dataRoot, 0);
		writeLocalManifest(dataRoot, []);

		mockQuery.mockResolvedValueOnce({ rows: [] });

		await reconcile({
			userId: "user-1",
			requiredVersion: 42,
					});

		expect(readSyncedVersion(dataRoot)).toBe(42);
	});
});
