import { beforeEach, describe, expect, it } from "bun:test";
import { getDb } from "./db";

describe("db", () => {
	beforeEach(() => {
		process.env.DATABASE_URL = "mysql://localhost/test";
	});

	it("returns the same instance on repeated calls", () => {
		const db1 = getDb();
		const db2 = getDb();
		expect(db1).toBe(db2);
	});
});
