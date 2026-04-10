import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

export function createDb(connectionString: string, poolSize = 10) {
	const pool = mysql.createPool({
		uri: connectionString,
		connectionLimit: poolSize,
		connectTimeout: 5_000,
		idleTimeout: 30_000,
	});
	const db = drizzle({ client: pool, schema, mode: "default" });
	return Object.assign(db, {
		async close() {
			await pool.end();
		},
	});
}

export type Database = ReturnType<typeof createDb>;
