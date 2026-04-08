import { query, queryOne } from "./client";

export interface UserSandboxRuntime {
	user_id: string;
	sandbox_id: string | null;
	state_version: number;
	synced_version: number;
	sandbox_status: string;
	daemon_version: string | null;
	last_seen_at: string;
}

/**
 * Get the sandbox runtime state for a user.
 */
export async function getRuntime(
	userId: string,
): Promise<UserSandboxRuntime | null> {
	return queryOne<UserSandboxRuntime>(
		`SELECT user_id, sandbox_id,
		        state_version::int, synced_version::int,
		        sandbox_status, daemon_version, last_seen_at::text
		 FROM user_sandbox_runtime
		 WHERE user_id = $1`,
		[userId],
	);
}

/**
 * Upsert sandbox runtime fields for a user.
 * Both INSERT and UPDATE paths include all supplied fields.
 */
export async function upsertRuntime(
	userId: string,
	fields: Partial<
		Pick<
			UserSandboxRuntime,
			"sandbox_id" | "synced_version" | "sandbox_status" | "daemon_version"
		>
	>,
): Promise<void> {
	const insertCols = ["user_id"];
	const insertVals = ["$1"];
	const setClauses: string[] = ["last_seen_at = now()"];
	const values: unknown[] = [userId];
	let paramIndex = 2;

	const fieldMap: Array<[keyof typeof fields, string]> = [
		["sandbox_id", "sandbox_id"],
		["synced_version", "synced_version"],
		["sandbox_status", "sandbox_status"],
		["daemon_version", "daemon_version"],
	];

	for (const [key, col] of fieldMap) {
		if (fields[key] !== undefined) {
			insertCols.push(col);
			insertVals.push(`$${paramIndex}`);
			setClauses.push(`${col} = $${paramIndex}`);
			values.push(fields[key]);
			paramIndex++;
		}
	}

	await query(
		`INSERT INTO user_sandbox_runtime (${insertCols.join(", ")})
		 VALUES (${insertVals.join(", ")})
		 ON CONFLICT (user_id) DO UPDATE
		 SET ${setClauses.join(", ")}`,
		values,
	);
}

/**
 * Get state_version for a user (lightweight query for turn setup).
 */
export async function getTurnContext(
	userId: string,
): Promise<{ state_version: number }> {
	const row = await queryOne<{ state_version: number }>(
		`SELECT state_version::int
		 FROM user_sandbox_runtime
		 WHERE user_id = $1`,
		[userId],
	);
	return { state_version: row?.state_version ?? 0 };
}
