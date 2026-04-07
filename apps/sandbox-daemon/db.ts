import { Pool } from "pg";

let pool: Pool | null = null;
let currentConnectionString = "";

/**
 * Get or create a shared Pool for the daemon.
 * Re-creates if the connection string changes.
 */
export function getPool(connectionString: string): Pool {
	if (pool && currentConnectionString === connectionString) {
		return pool;
	}
	if (pool) {
		pool.end().catch(() => {});
	}
	pool = new Pool({
		connectionString,
		max: 3,
		idleTimeoutMillis: 30_000,
	});
	currentConnectionString = connectionString;
	return pool;
}
