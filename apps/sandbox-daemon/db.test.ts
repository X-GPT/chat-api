import { describe, expect, it } from "bun:test";
import { getPool } from "./db";

describe("db", () => {
	it("returns the same pool for the same connection string", () => {
		const pool1 = getPool("postgresql://localhost/test1");
		const pool2 = getPool("postgresql://localhost/test1");
		expect(pool1).toBe(pool2);
		pool1.end();
	});

	it("creates a new pool when connection string changes", () => {
		const pool1 = getPool("postgresql://localhost/testA");
		const pool2 = getPool("postgresql://localhost/testB");
		expect(pool1).not.toBe(pool2);
		pool2.end();
	});
});
