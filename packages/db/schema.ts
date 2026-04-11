import {
	bigint,
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
		slug: text("slug").notNull(),
		pathKey: text("path_key").notNull(),
		content: mediumtext("content").notNull(),
		checksum: varchar("checksum", { length: 255 }).notNull(),
		updatedAt: timestamp("updated_at", { mode: "string" })
			.notNull()
			.defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.documentId] })],
);

export const userSandboxRuntime = mysqlTable("user_sandbox_runtime", {
	userId: varchar("user_id", { length: 255 }).notNull().primaryKey(),
	sandboxId: varchar("sandbox_id", { length: 255 }),
	stateVersion: bigint("state_version", { mode: "number" })
		.notNull()
		.default(0),
	lastSeenAt: timestamp("last_seen_at", { mode: "string" })
		.notNull()
		.defaultNow(),
});

export const userSandboxSessions = mysqlTable(
	"user_sandbox_sessions",
	{
		userId: varchar("user_id", { length: 255 }).notNull(),
		chatKey: varchar("chat_key", { length: 255 }).notNull(),
		sessionId: varchar("session_id", { length: 255 }).notNull(),
		updatedAt: timestamp("updated_at", { mode: "string" })
			.notNull()
			.defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.chatKey] })],
);
