import { describe, expect, it, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	readLocalManifest,
	writeLocalManifest,
	readSyncedVersion,
	writeSyncedVersion,
	type LocalManifestEntry,
} from "./state";

describe("state", () => {
	const testRoot = join(tmpdir(), `state-test-${Date.now()}`);

	afterAll(() => {
		rmSync(testRoot, { recursive: true, force: true });
	});

	describe("local manifest", () => {
		it("returns empty array when no manifest exists", () => {
			const result = readLocalManifest(join(testRoot, "nonexistent"));
			expect(result).toEqual([]);
		});

		it("round-trips manifest entries", () => {
			const dataRoot = join(testRoot, "manifest-roundtrip");
			mkdirSync(dataRoot, { recursive: true });

			const entries: LocalManifestEntry[] = [
				{
					document_id: "doc-1",
					type: 0,
					slug: "my-document",
					path_key: "col-A",
					checksum: "abc123",
				},
				{
					document_id: "doc-2",
					type: 3,
					slug: "my-note",
					path_key: "",
					checksum: "def456",
				},
			];

			writeLocalManifest(dataRoot, entries);
			const result = readLocalManifest(dataRoot);
			expect(result).toEqual(entries);
		});

		it("returns empty array for corrupt JSON", () => {
			const dataRoot = join(testRoot, "manifest-corrupt");
			mkdirSync(dataRoot, { recursive: true });
			Bun.write(join(dataRoot, ".sync-manifest.json"), "not json");

			const result = readLocalManifest(dataRoot);
			expect(result).toEqual([]);
		});
	});

	describe("synced version", () => {
		it("returns 0 when no version file exists", () => {
			const result = readSyncedVersion(join(testRoot, "no-version"));
			expect(result).toBe(0);
		});

		it("round-trips version number", () => {
			const dataRoot = join(testRoot, "version-roundtrip");
			mkdirSync(dataRoot, { recursive: true });

			writeSyncedVersion(dataRoot, 42);
			const result = readSyncedVersion(dataRoot);
			expect(result).toBe(42);
		});

		it("returns 0 for invalid version content", () => {
			const dataRoot = join(testRoot, "version-invalid");
			mkdirSync(dataRoot, { recursive: true });
			Bun.write(join(dataRoot, ".synced-version"), "not-a-number");

			const result = readSyncedVersion(dataRoot);
			expect(result).toBe(0);
		});
	});
});
