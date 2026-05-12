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

import type { SyncEvent } from "./ipc-protocol";
import { getDataRoot } from "./materialization";
import { reconcile } from "./reconcile";

function emit(event: SyncEvent): void {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}

// Walk the .cause chain so wrapper errors (e.g. drizzle's DrizzleQueryError,
// which sets .message to "Failed query: ..." regardless of the underlying
// failure mode) don't hide the actual reason in the daemon log.
function describeError(err: unknown): string {
	const parts: string[] = [];
	let cur: unknown = err;
	const seen = new Set<unknown>();
	while (cur && !seen.has(cur)) {
		seen.add(cur);
		if (cur instanceof Error) {
			const code = (cur as Error & { code?: string }).code;
			parts.push(code ? `${cur.message} [${code}]` : cur.message);
			cur = (cur as Error & { cause?: unknown }).cause;
		} else {
			parts.push(String(cur));
			break;
		}
	}
	return parts.join(" <- ");
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
		emit({ type: "failed", message: describeError(err) });
		process.exit(1);
	}

	try {
		const changed = await reconcile({ userId });
		emit({ type: "synced", changed, dataRoot: getDataRoot(userId) });
		process.exit(0);
	} catch (err) {
		emit({ type: "failed", message: describeError(err) });
		process.exit(1);
	}
}

main();
