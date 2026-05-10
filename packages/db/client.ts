import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function createDb(connectionString: string, poolSize = 10) {
	const pool = new Pool({
		connectionString,
		max: poolSize,
		connectionTimeoutMillis: 30_000,
		idleTimeoutMillis: 30_000,
	});
	const db = drizzle(pool, { schema });
	return Object.assign(db, {
		async close() {
			await pool.end();
		},
	});
}

export type Database = ReturnType<typeof createDb>;
