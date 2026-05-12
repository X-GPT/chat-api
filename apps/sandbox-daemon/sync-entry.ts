/**
 * Sync command: reconciles the local filesystem with the database for a
 * single user, then exits. Spawned per-turn by the daemon.
 *
 * Usage:   bun sync.js --user-id <id>
 * Stdout:  NDJSON. Exactly one terminal event per run:
 *            { type: "synced", changed: boolean, dataRoot: "..." }
 *            { type: "failed", message: "..." }
 * Exit:    0 on success, 1 on failure.
 *
 * Required env: DATABASE_URL
 *
 * No other code path inside the daemon process reaches DB code — this
 * entrypoint owns the only import of @mymemo/db / drizzle-orm in the
 * sandbox bundle graph.
 */

import { getDataRoot } from "./materialization";
import { reconcile } from "./reconcile";

function emit(obj: Record<string, unknown>): void {
	process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function parseArgs(argv: string[]): { userId: string } {
	const idx = argv.indexOf("--user-id");
	if (idx === -1 || !argv[idx + 1]) {
		throw new Error("--user-id <id> required");
	}
	return { userId: argv[idx + 1] as string };
}

async function main() {
	if (!process.env.DATABASE_URL) {
		emit({ type: "failed", message: "DATABASE_URL not set in sync env" });
		process.exit(1);
	}

	let userId: string;
	try {
		({ userId } = parseArgs(process.argv.slice(2)));
	} catch (err) {
		emit({
			type: "failed",
			message: err instanceof Error ? err.message : String(err),
		});
		process.exit(1);
	}

	try {
		const changed = await reconcile({ userId });
		emit({ type: "synced", changed, dataRoot: getDataRoot(userId) });
		process.exit(0);
	} catch (err) {
		emit({
			type: "failed",
			message: err instanceof Error ? err.message : String(err),
		});
		process.exit(1);
	}
}

main();
