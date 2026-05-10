import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testRoot = join(tmpdir(), `reconcile-test-${Date.now()}`);

const mockGetAllDocMeta = mock();
const mockGetDocContents = mock();
const mockGetAllMemberships = mock();

mock.module("./queries", () => ({
	getAllDocMeta: mockGetAllDocMeta,
	getDocContents: mockGetDocContents,
	getAllMemberships: mockGetAllMemberships,
}));

mock.module("./materialization", () => {
	const actual = require("./materialization");
	return {
		...actual,
		getDataRoot: (_userId: string) => join(testRoot, "data"),
	};
});

import {
	getMtimeSeconds,
	stampMtime,
	toEpochSeconds,
	writeCanonicalFile,
} from "./materialization";
import { reconcile } from "./reconcile";

function docMeta(
	overrides: Partial<{
		document_id: string;
		type: number;
		title: string | null;
		updated_at: string;
	}> = {},
) {
	return {
		document_id: "doc-1",
		type: 0,
		title: null,
		updated_at: "2026-01-01 00:00:00",
		...overrides,
	};
}

function docContent(
	overrides: Partial<{
		document_id: string;
		type: number;
		title: string | null;
		updated_at: string;
		content: string;
	}> = {},
) {
	return {
		document_id: "doc-1",
		type: 0,
		title: null,
		updated_at: "2026-01-01 00:00:00",
		content: "body",
		...overrides,
	};
}

function membership(
	overrides: Partial<{
		document_id: string;
		collection_id: string;
		collection_name: string;
		updated_at: string;
	}> = {},
) {
	return {
		document_id: "doc-1",
		collection_id: "col-A",
		collection_name: "Research",
		updated_at: "2026-01-01 00:00:00",
		...overrides,
	};
}

describe("reconcile", () => {
	const dataRoot = join(testRoot, "data");

	beforeEach(() => {
		mockGetAllDocMeta.mockReset();
		mockGetDocContents.mockReset();
		mockGetAllMemberships.mockReset();
		mockGetAllDocMeta.mockResolvedValue([]);
		mockGetDocContents.mockResolvedValue([]);
		mockGetAllMemberships.mockResolvedValue([]);
		rmSync(dataRoot, { recursive: true, force: true });
		mkdirSync(dataRoot, { recursive: true });
	});

	afterAll(() => {
		rmSync(testRoot, { recursive: true, force: true });
		mock.restore();
	});

	it("materializes everything on first run with empty dataRoot", async () => {
		mockGetAllDocMeta.mockResolvedValueOnce([
			docMeta({ document_id: "doc-1", title: "First", updated_at: "2026-01-01 00:00:00" }),
		]);
		mockGetDocContents.mockResolvedValueOnce([
			docContent({ document_id: "doc-1", title: "First", content: "hello" }),
		]);
		mockGetAllMemberships.mockResolvedValueOnce([
			membership({ document_id: "doc-1", collection_id: "col-A" }),
		]);

		const result = await reconcile({ userId: "user-1" });

		expect(result).toBe(true);
		expect(existsSync(join(dataRoot, "canonical/0/doc-1.md"))).toBe(true);
		expect(existsSync(join(dataRoot, "collections/col-A/0/doc-1.md"))).toBe(
			true,
		);
		expect(existsSync(join(dataRoot, "canonical/_index.md"))).toBe(true);

		const canonicalMtime = getMtimeSeconds(
			join(dataRoot, "canonical/0/doc-1.md"),
		);
		expect(canonicalMtime).toBe(toEpochSeconds("2026-01-01 00:00:00"));
	});

	it("skips all disk writes when nothing changed", async () => {
		const t = "2026-01-01 00:00:00";
		writeCanonicalFile(dataRoot, {
			document_id: "doc-1",
			type: 0,
			content: "hello",
			title: "First",
		});
		stampMtime(join(dataRoot, "canonical/0/doc-1.md"), t);
		// Pre-build hardlink + index with matching mtimes.
		mkdirSync(join(dataRoot, "collections/col-A/0"), { recursive: true });
		require("node:fs").linkSync(
			join(dataRoot, "canonical/0/doc-1.md"),
			join(dataRoot, "collections/col-A/0/doc-1.md"),
		);
		// Pre-write index and stamp it to match.
		writeFileSync(join(dataRoot, "canonical/_index.md"), "stub");
		stampMtime(join(dataRoot, "canonical/_index.md"), t);

		mockGetAllDocMeta.mockResolvedValueOnce([
			docMeta({ document_id: "doc-1", title: "First", updated_at: t }),
		]);
		mockGetAllMemberships.mockResolvedValueOnce([
			membership({ document_id: "doc-1", collection_id: "col-A", updated_at: t }),
		]);

		const result = await reconcile({ userId: "user-1" });

		expect(result).toBe(false);
		expect(mockGetDocContents).not.toHaveBeenCalled();
		// Index file wasn't rewritten (still has stub content).
		expect(readFileSync(join(dataRoot, "canonical/_index.md"), "utf-8")).toBe(
			"stub",
		);
	});

	it("rewrites a doc when updated_at bumps", async () => {
		writeCanonicalFile(dataRoot, {
			document_id: "doc-1",
			type: 0,
			content: "old",
			title: "First",
		});
		stampMtime(
			join(dataRoot, "canonical/0/doc-1.md"),
			"2026-01-01 00:00:00",
		);

		mockGetAllDocMeta.mockResolvedValueOnce([
			docMeta({
				document_id: "doc-1",
				title: "First",
				updated_at: "2026-01-02 00:00:00",
			}),
		]);
		mockGetDocContents.mockResolvedValueOnce([
			docContent({
				document_id: "doc-1",
				title: "First",
				content: "new body",
				updated_at: "2026-01-02 00:00:00",
			}),
		]);

		const result = await reconcile({ userId: "user-1" });

		expect(result).toBe(true);
		expect(mockGetDocContents).toHaveBeenCalledWith("user-1", ["doc-1"]);
		const fileText = readFileSync(
			join(dataRoot, "canonical/0/doc-1.md"),
			"utf-8",
		);
		expect(fileText).toContain("new body");
		expect(
			getMtimeSeconds(join(dataRoot, "canonical/0/doc-1.md")),
		).toBe(toEpochSeconds("2026-01-02 00:00:00"));
	});

	it("handles a type change: orphans old path and writes new", async () => {
		// Seed: doc-1 at type 0.
		writeCanonicalFile(dataRoot, {
			document_id: "doc-1",
			type: 0,
			content: "body",
			title: "First",
		});
		stampMtime(
			join(dataRoot, "canonical/0/doc-1.md"),
			"2026-01-01 00:00:00",
		);

		mockGetAllDocMeta.mockResolvedValueOnce([
			docMeta({
				document_id: "doc-1",
				type: 3,
				title: "First",
				updated_at: "2026-01-02 00:00:00",
			}),
		]);
		mockGetDocContents.mockResolvedValueOnce([
			docContent({
				document_id: "doc-1",
				type: 3,
				title: "First",
				content: "body",
				updated_at: "2026-01-02 00:00:00",
			}),
		]);

		const result = await reconcile({ userId: "user-1" });

		expect(result).toBe(true);
		expect(existsSync(join(dataRoot, "canonical/0/doc-1.md"))).toBe(false);
		expect(existsSync(join(dataRoot, "canonical/3/doc-1.md"))).toBe(true);
	});

	it("deletes a doc and all its hardlinks when it disappears from DB", async () => {
		writeCanonicalFile(dataRoot, {
			document_id: "doc-1",
			type: 0,
			content: "body",
			title: "First",
		});
		stampMtime(
			join(dataRoot, "canonical/0/doc-1.md"),
			"2026-01-01 00:00:00",
		);
		mkdirSync(join(dataRoot, "collections/col-A/0"), { recursive: true });
		require("node:fs").linkSync(
			join(dataRoot, "canonical/0/doc-1.md"),
			join(dataRoot, "collections/col-A/0/doc-1.md"),
		);

		// DB now has no docs and no memberships.
		const result = await reconcile({ userId: "user-1" });

		expect(result).toBe(true);
		expect(existsSync(join(dataRoot, "canonical/0/doc-1.md"))).toBe(false);
		expect(existsSync(join(dataRoot, "collections/col-A/0/doc-1.md"))).toBe(
			false,
		);
	});

	it("creates only a hardlink when membership is added for an existing doc", async () => {
		const t = "2026-01-01 00:00:00";
		writeCanonicalFile(dataRoot, {
			document_id: "doc-1",
			type: 0,
			content: "body",
			title: "First",
		});
		stampMtime(join(dataRoot, "canonical/0/doc-1.md"), t);
		const canonicalMtimeBefore = getMtimeSeconds(
			join(dataRoot, "canonical/0/doc-1.md"),
		);

		mockGetAllDocMeta.mockResolvedValueOnce([
			docMeta({ document_id: "doc-1", title: "First", updated_at: t }),
		]);
		mockGetAllMemberships.mockResolvedValueOnce([
			membership({
				document_id: "doc-1",
				collection_id: "col-A",
				updated_at: "2026-02-01 00:00:00",
			}),
		]);

		const result = await reconcile({ userId: "user-1" });

		expect(result).toBe(true);
		expect(mockGetDocContents).not.toHaveBeenCalled();
		expect(existsSync(join(dataRoot, "collections/col-A/0/doc-1.md"))).toBe(
			true,
		);
		// Canonical file was NOT rewritten — mtime unchanged.
		expect(
			getMtimeSeconds(join(dataRoot, "canonical/0/doc-1.md")),
		).toBe(canonicalMtimeBefore);
	});

	it("removes only a hardlink when membership is removed", async () => {
		const t = "2026-01-01 00:00:00";
		writeCanonicalFile(dataRoot, {
			document_id: "doc-1",
			type: 0,
			content: "body",
			title: "First",
		});
		stampMtime(join(dataRoot, "canonical/0/doc-1.md"), t);
		mkdirSync(join(dataRoot, "collections/col-A/0"), { recursive: true });
		require("node:fs").linkSync(
			join(dataRoot, "canonical/0/doc-1.md"),
			join(dataRoot, "collections/col-A/0/doc-1.md"),
		);

		mockGetAllDocMeta.mockResolvedValueOnce([
			docMeta({ document_id: "doc-1", title: "First", updated_at: t }),
		]);
		// No memberships.

		const result = await reconcile({ userId: "user-1" });

		expect(result).toBe(true);
		expect(existsSync(join(dataRoot, "canonical/0/doc-1.md"))).toBe(true);
		expect(existsSync(join(dataRoot, "collections/col-A/0/doc-1.md"))).toBe(
			false,
		);
	});

	it("regenerates _index.md when a collection is renamed without touching canonical", async () => {
		const t = "2026-01-01 00:00:00";
		writeCanonicalFile(dataRoot, {
			document_id: "doc-1",
			type: 0,
			content: "body",
			title: "First",
		});
		stampMtime(join(dataRoot, "canonical/0/doc-1.md"), t);
		const canonicalMtimeBefore = getMtimeSeconds(
			join(dataRoot, "canonical/0/doc-1.md"),
		);

		mkdirSync(join(dataRoot, "collections/col-A/0"), { recursive: true });
		require("node:fs").linkSync(
			join(dataRoot, "canonical/0/doc-1.md"),
			join(dataRoot, "collections/col-A/0/doc-1.md"),
		);

		// Pre-write index matching the OLD membership updated_at (t).
		writeFileSync(join(dataRoot, "canonical/_index.md"), "old index");
		stampMtime(join(dataRoot, "canonical/_index.md"), t);

		mockGetAllDocMeta.mockResolvedValueOnce([
			docMeta({ document_id: "doc-1", title: "First", updated_at: t }),
		]);
		mockGetAllMemberships.mockResolvedValueOnce([
			membership({
				document_id: "doc-1",
				collection_id: "col-A",
				collection_name: "Research Renamed",
				updated_at: "2026-03-01 00:00:00",
			}),
		]);

		const result = await reconcile({ userId: "user-1" });

		expect(result).toBe(true);
		expect(mockGetDocContents).not.toHaveBeenCalled();
		expect(
			getMtimeSeconds(join(dataRoot, "canonical/0/doc-1.md")),
		).toBe(canonicalMtimeBefore);

		const indexText = readFileSync(
			join(dataRoot, "canonical/_index.md"),
			"utf-8",
		);
		expect(indexText).toContain("Research Renamed");
		expect(
			getMtimeSeconds(join(dataRoot, "canonical/_index.md")),
		).toBe(toEpochSeconds("2026-03-01 00:00:00"));
	});

	it("refetches a doc when its canonical file was externally deleted", async () => {
		const t = "2026-01-01 00:00:00";
		writeCanonicalFile(dataRoot, {
			document_id: "doc-1",
			type: 0,
			content: "old",
			title: "First",
		});
		stampMtime(join(dataRoot, "canonical/0/doc-1.md"), t);
		rmSync(join(dataRoot, "canonical/0/doc-1.md"));

		mockGetAllDocMeta.mockResolvedValueOnce([
			docMeta({ document_id: "doc-1", title: "First", updated_at: t }),
		]);
		mockGetDocContents.mockResolvedValueOnce([
			docContent({
				document_id: "doc-1",
				title: "First",
				content: "restored",
				updated_at: t,
			}),
		]);

		const result = await reconcile({ userId: "user-1" });

		expect(result).toBe(true);
		expect(existsSync(join(dataRoot, "canonical/0/doc-1.md"))).toBe(true);
		expect(
			readFileSync(join(dataRoot, "canonical/0/doc-1.md"), "utf-8"),
		).toContain("restored");
	});

	it("writes _index.md with collection names from membership rows", async () => {
		mockGetAllDocMeta.mockResolvedValueOnce([
			docMeta({ document_id: "doc-1", title: "Article", updated_at: "2026-01-01 00:00:00" }),
		]);
		mockGetDocContents.mockResolvedValueOnce([
			docContent({ document_id: "doc-1", title: "Article", content: "body" }),
		]);
		mockGetAllMemberships.mockResolvedValueOnce([
			membership({
				document_id: "doc-1",
				collection_id: "col-A",
				collection_name: "Research",
				updated_at: "2026-01-01 00:00:00",
			}),
		]);

		await reconcile({ userId: "user-1" });

		const indexText = readFileSync(
			join(dataRoot, "canonical/_index.md"),
			"utf-8",
		);
		expect(indexText).toContain("# Collections");
		expect(indexText).toContain("## Research (col-A)");
		expect(indexText).toContain("- Article (0/doc-1.md)");
	});

	it("canonical frontmatter contains only title and cite", async () => {
		mockGetAllDocMeta.mockResolvedValueOnce([
			docMeta({ document_id: "doc-new", title: "New Doc", updated_at: "2026-01-01 00:00:00" }),
		]);
		mockGetDocContents.mockResolvedValueOnce([
			docContent({
				document_id: "doc-new",
				title: "New Doc",
				content: "body",
			}),
		]);
		mockGetAllMemberships.mockResolvedValueOnce([
			membership({
				document_id: "doc-new",
				collection_id: "col-B",
				collection_name: "Books",
				updated_at: "2026-01-01 00:00:00",
			}),
		]);

		await reconcile({ userId: "user-1" });

		const text = readFileSync(
			join(dataRoot, "canonical/0/doc-new.md"),
			"utf-8",
		);
		expect(text).toContain('title: "New Doc"');
		expect(text).toContain("cite: detail/0/doc-new");
		expect(text).not.toContain("collections:");
		expect(text).not.toContain("checksum");
	});
});
