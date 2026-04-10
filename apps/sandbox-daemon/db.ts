import { createDb, type Database } from "@mymemo/db";

let db: Database | null = null;

export function getDb(): Database {
	if (!db) {
		db = createDb(process.env.DATABASE_URL as string, 3);
	}
	return db;
}
