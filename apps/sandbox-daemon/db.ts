import { Pool } from "pg";

let pool: Pool | null = null;

/**
 * Get or create a shared Pool for the daemon.
 * Uses DATABASE_URL from the process environment (set at daemon startup).
 */
export function getPool(): Pool {
	if (pool) return pool;
	pool = new Pool({
		connectionString: process.env.DATABASE_URL,
		max: 3,
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 5_000,
	});
	return pool;
}
