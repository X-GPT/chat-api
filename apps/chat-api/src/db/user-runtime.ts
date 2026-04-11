import { userSandboxRuntime } from "@mymemo/db";
import { eq, sql } from "drizzle-orm";
import { getDb } from "./client";

export interface UserSandboxRuntime {
	user_id: string;
	sandbox_id: string | null;
	state_version: number;
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
			last_seen_at: userSandboxRuntime.lastSeenAt,
		})
		.from(userSandboxRuntime)
		.where(eq(userSandboxRuntime.userId, userId));
	return rows[0] ?? null;
}

/**
 * Upsert sandbox runtime fields for a user.
 */
export async function upsertRuntime(
	userId: string,
	fields: Partial<Pick<UserSandboxRuntime, "sandbox_id">>,
): Promise<void> {
	await getDb()
		.insert(userSandboxRuntime)
		.values({
			userId,
			sandboxId: fields.sandbox_id ?? undefined,
		})
		.onDuplicateKeyUpdate({
			set: {
				lastSeenAt: sql`NOW()`,
				...(fields.sandbox_id !== undefined && {
					sandboxId: fields.sandbox_id,
				}),
			},
		});
}
