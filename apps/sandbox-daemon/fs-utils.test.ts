import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureParentDir } from "./fs-utils";

describe("ensureParentDir", () => {
	const testRoot = join(tmpdir(), `fs-utils-test-${Date.now()}`);

	afterAll(() => {
		rmSync(testRoot, { recursive: true, force: true });
	});

	it("creates nested parent directories", () => {
		const filePath = join(testRoot, "a", "b", "c", "file.txt");
		ensureParentDir(filePath);
		expect(existsSync(join(testRoot, "a", "b", "c"))).toBe(true);
	});

	it("is idempotent", () => {
		const filePath = join(testRoot, "a", "b", "c", "file.txt");
		ensureParentDir(filePath);
		ensureParentDir(filePath); // should not throw
		expect(existsSync(join(testRoot, "a", "b", "c"))).toBe(true);
	});
});
