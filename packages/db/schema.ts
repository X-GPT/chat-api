import {
	bigint,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";

/**
 * Authoritative document table (externally managed).
 * Soft-deleted rows are marked `del_flag = '1'`.
 */
export const platformKnowledge = pgTable("platform_knowledge", {
	id: bigint("id", { mode: "bigint" }).primaryKey(),
	teamCode: text("team_code").notNull().default(""),
	partnerCode: text("partner_code").notNull().default(""),
	memberCode: text("member_code").notNull().default(""),
	docId: text("doc_id").notNull().default(""),
	fileName: text("file_name").notNull().default(""),
	title: text("title").notNull().default(""),
	summaryTitle: text("summary_title").notNull().default(""),
	content: text("content").notNull().default(""),
	parseContent: text("parse_content").notNull().default(""),
	type: integer("type").notNull().default(0),
	delFlag: text("del_flag").notNull().default("0"),
	updateTime: timestamp("update_time", { mode: "string", withTimezone: true })
		.notNull()
		.defaultNow(),
});

/**
 * Authoritative collection table (externally managed).
 * `compat_id` is the stable text ID the daemon exposes to the agent.
 */
export const platformCollection = pgTable("platform_collection", {
	id: bigint("id", { mode: "bigint" }).primaryKey(),
	teamCode: text("team_code").notNull().default(""),
	partnerCode: text("partner_code").notNull().default(""),
	memberCode: text("member_code").notNull().default(""),
	name: text("name").notNull().default(""),
	compatId: text("compat_id"),
	delFlag: text("del_flag").notNull().default("0"),
	updateTime: timestamp("update_time", { mode: "string", withTimezone: true })
		.notNull()
		.defaultNow(),
});

/**
 * Many-to-many membership of knowledge ↔ collection (externally managed).
 * There is no `updated_at` here — collection-name changes bubble in via a join
 * on `platform_collection.update_time`.
 */
export const platformKnowledgeCollection = pgTable(
	"platform_knowledge_collection",
	{
		knowledgeId: bigint("knowledge_id", { mode: "bigint" }).notNull(),
		collectionId: bigint("collection_id", { mode: "bigint" }).notNull(),
		createTime: timestamp("create_time", {
			mode: "string",
			withTimezone: true,
		})
			.notNull()
			.defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.knowledgeId, table.collectionId] }),
	],
);

/**
 * Daemon-owned per-user sandbox runtime state.
 */
export const userSandboxRuntime = pgTable("user_sandbox_runtime", {
	userId: varchar("user_id", { length: 255 }).notNull().primaryKey(),
	sandboxId: varchar("sandbox_id", { length: 255 }),
	lastSeenAt: timestamp("last_seen_at", { mode: "string", withTimezone: false })
		.notNull()
		.defaultNow(),
});

/**
 * Daemon-owned per-chat agent session IDs for conversation resume.
 */
export const userSandboxSessions = pgTable(
	"user_sandbox_sessions",
	{
		userId: varchar("user_id", { length: 255 }).notNull(),
		chatKey: varchar("chat_key", { length: 255 }).notNull(),
		sessionId: varchar("session_id", { length: 255 }).notNull(),
		updatedAt: timestamp("updated_at", { mode: "string", withTimezone: false })
			.notNull()
			.defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.chatKey] })],
);
