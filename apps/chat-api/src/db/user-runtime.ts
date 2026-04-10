import { userSandboxRuntime } from "@mymemo/db";
import { eq, sql } from "drizzle-orm";
import { getDb } from "./client";

export interface UserSandboxRuntime {
	user_id: string;
	sandbox_id: string | null;
	state_version: number;
	synced_version: number;
	last_seen_at: string;
}

/**
 * Get the sandbox runtime state for a user.
 */
export async function getRuntime(
	userId: string,
): Promise<UserSandboxRuntime | null> {
	const rows = await getDb()
		.select({
			user_id: userSandboxRuntime.userId,
			sandbox_id: userSandboxRuntime.sandboxId,
			state_version: userSandboxRuntime.stateVersion,
			synced_version: userSandboxRuntime.syncedVersion,
			last_seen_at: userSandboxRuntime.lastSeenAt,
		})
		.from(userSandboxRuntime)
		.where(eq(userSandboxRuntime.userId, userId));
	return rows[0] ?? null;
}

/**
 * Upsert sandbox runtime fields for a user.
 * Both INSERT and UPDATE paths include all supplied fields.
 */
export async function upsertRuntime(
	userId: string,
	fields: Partial<Pick<UserSandboxRuntime, "sandbox_id" | "synced_version">>,
): Promise<void> {
	await getDb()
		.insert(userSandboxRuntime)
		.values({
			userId,
			sandboxId: fields.sandbox_id ?? undefined,
			syncedVersion: fields.synced_version ?? undefined,
		})
		.onDuplicateKeyUpdate({
			set: {
				lastSeenAt: sql`NOW()`,
				...(fields.sandbox_id !== undefined && {
					sandboxId: fields.sandbox_id,
				}),
				...(fields.synced_version !== undefined && {
					syncedVersion: fields.synced_version,
				}),
			},
		});
}
