import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type LocalManifestEntry,
	readLocalManifest,
	writeLocalManifest,
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
					path_key: "col-A",
					checksum: "abc123",
				},
				{
					document_id: "doc-2",
					type: 3,
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
});
