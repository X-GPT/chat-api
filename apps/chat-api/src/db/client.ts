import { createDb, type Database } from "@mymemo/db";
import { apiEnv } from "@/config/env";

let db: Database | null = null;

export function getDb(): Database {
	if (!db) {
		db = createDb(apiEnv.DATABASE_URL as string, 10);
	}
	return db;
}

export async function closeDb(): Promise<void> {
	if (db) {
		await db.close();
		db = null;
	}
}
