import { describe, expect, it, beforeEach } from "bun:test";
import { getPool } from "./db";

describe("db", () => {
	beforeEach(() => {
		process.env.DATABASE_URL = "postgresql://localhost/test";
	});

	it("returns the same pool on repeated calls", () => {
		const pool1 = getPool();
		const pool2 = getPool();
		expect(pool1).toBe(pool2);
		pool1.end();
	});
});
