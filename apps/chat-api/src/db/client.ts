import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { apiEnv } from "@/config/env";

let pool: Pool | null = null;

export function getPool(): Pool {
	if (!pool) {
		pool = new Pool({
			connectionString: apiEnv.DATABASE_URL ?? undefined,
			max: 10,
			idleTimeoutMillis: 30_000,
			connectionTimeoutMillis: 5_000,
		});
	}
	return pool;
}

export async function query<T extends QueryResultRow>(
	text: string,
	params?: unknown[],
): Promise<T[]> {
	const result = await getPool().query<T>(text, params);
	return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
	text: string,
	params?: unknown[],
): Promise<T | null> {
	const rows = await query<T>(text, params);
	return rows[0] ?? null;
}

export async function withClient<T>(
	fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await getPool().connect();
	try {
		return await fn(client);
	} finally {
		client.release();
	}
}

export async function shutdownPool(): Promise<void> {
	if (pool) {
		await pool.end();
		pool = null;
	}
}
