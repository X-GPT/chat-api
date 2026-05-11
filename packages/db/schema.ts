import {
	int,
	mediumtext,
	mysqlTable,
	primaryKey,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/mysql-core";

export const userFiles = mysqlTable(
	"user_files",
	{
		userId: varchar("user_id", { length: 255 }).notNull(),
		documentId: varchar("document_id", { length: 255 }).notNull(),
		type: int("type").notNull().default(0),
		pathKey: text("path_key").notNull(),
		content: mediumtext("content").notNull(),
		checksum: varchar("checksum", { length: 255 }).notNull(),
		title: varchar("title", { length: 500 }),
		updatedAt: timestamp("updated_at", { mode: "string" })
			.notNull()
			.defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.documentId] })],
);

export const userCollections = mysqlTable(
	"user_collections",
	{
		userId: varchar("user_id", { length: 255 }).notNull(),
		collectionId: varchar("collection_id", { length: 255 }).notNull(),
		name: varchar("name", { length: 500 }).notNull(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.collectionId] })],
);
