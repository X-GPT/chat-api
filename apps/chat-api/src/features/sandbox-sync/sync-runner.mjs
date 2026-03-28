/**
 * Sandbox Sync Runner
 *
 * Runs inside an E2B sandbox. Pulls source data from the chat-api
 * internal sync endpoint, compares against a local manifest, and only
 * materializes + writes files that have changed.
 *
 * Usage: node sync-runner.mjs sync-request.json
 *
 * Input JSON: { syncEndpoint, userId, docsRoot }
 * Output: writes /workspace/.sync-status.json
 *
 * Manifest: {docsRoot}/.manifest.json — persists across sync runs.
 * Maps summaryId → { checksum, relativePath, collections }
 */

// NOTE: sanitize, resolveSourceKind, resolveContent, materialize below must
// stay in sync with src/features/sandbox/materialization.ts. Duplicated here
// because this file runs as plain Node.js inside the E2B sandbox.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const STATUS_PATH = "/workspace/.sync-status.json";

function writeStatus(status) {
	writeFileSync(
		STATUS_PATH,
		JSON.stringify({ ...status, timestamp: new Date().toISOString() }),
	);
}

function sanitize(value) {
	return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "unknown";
}

function resolveSourceKind(doc) {
	if (
		doc.fileType === "application/pdf" ||
		doc.fileType === "link/normal" ||
		doc.fileType === "link/video"
	) {
		return "parser_output";
	}
	if (doc.type === 3) {
		return "markdown";
	}
	return "text";
}

function resolveContent(doc) {
	const sourceKind = resolveSourceKind(doc);
	if (sourceKind === "parser_output") {
		return doc.parseContent ?? doc.content ?? "";
	}
	return doc.content ?? doc.parseContent ?? "";
}

function materialize(doc) {
	const type = doc.type ?? 0;
	const sourceKind = resolveSourceKind(doc);
	const title = (doc.title ?? "").trim();
	const body = resolveContent(doc).trim();

	const content = [
		"---",
		`summaryId: ${doc.summaryId}`,
		`type: ${type}`,
		`sourceKind: ${sourceKind}`,
		`title: ${JSON.stringify(title)}`,
		"---",
		"",
		body,
		"",
	].join("\n");

	const relativePath = `${type}/${sanitize(doc.summaryId)}.txt`;
	return { summaryId: doc.summaryId, type, relativePath, content };
}

function writeFile(path, content) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf-8");
}

function deleteFile(path) {
	try {
		rmSync(path);
	} catch {
		// File may already be gone
	}
}

function collectionPath(docsRoot, collectionId, relativePath) {
	return `${docsRoot}/collections/${sanitize(collectionId)}/${relativePath}`;
}

// ─── Manifest ────────────────────────────────────────────────────────────────

function loadManifest(docsRoot) {
	try {
		return JSON.parse(readFileSync(`${docsRoot}/.manifest.json`, "utf-8"));
	} catch {
		return {};
	}
}

function saveManifest(docsRoot, manifest) {
	writeFile(`${docsRoot}/.manifest.json`, JSON.stringify(manifest));
}

function collectionsEqual(a, b) {
	if (a.length !== b.length) return false;
	const sorted1 = [...a].sort();
	const sorted2 = [...b].sort();
	return sorted1.every((v, i) => v === sorted2[i]);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
	const requestPath = process.argv[2];
	if (!requestPath) {
		writeStatus({
			status: "error",
			message: "Usage: node sync-runner.mjs <sync-request.json>",
		});
		process.exit(1);
	}

	let config;
	try {
		config = JSON.parse(readFileSync(requestPath, "utf-8"));
	} catch (err) {
		writeStatus({
			status: "error",
			message: `Failed to read config: ${err.message}`,
		});
		process.exit(1);
	}

	const { syncEndpoint, userId, docsRoot } = config;
	if (!syncEndpoint || !userId || !docsRoot) {
		writeStatus({
			status: "error",
			message: "Config must include syncEndpoint, userId, and docsRoot",
		});
		process.exit(1);
	}

	writeStatus({ status: "syncing", pid: process.pid });

	try {
		mkdirSync(docsRoot, { recursive: true });

		const manifest = loadManifest(docsRoot);
		const newManifest = {};
		const stats = { created: 0, updated: 0, deleted: 0, unchanged: 0 };

		// Fetch all docs and reconcile
		let cursor = 0;
		const limit = 100;
		let hasMore = true;

		while (hasMore) {
			const url = `${syncEndpoint}/${encodeURIComponent(userId)}?cursor=${cursor}&limit=${limit}`;
			const response = await fetch(url);

			if (!response.ok) {
				throw new Error(
					`Sync endpoint returned ${response.status}: ${await response.text()}`,
				);
			}

			const data = await response.json();
			const { documents, nextCursor } = data;

			for (const doc of documents) {
				const existing = manifest[doc.summaryId];
				const collections = doc.collections ?? [];

				// Check if content and collections are unchanged
				if (
					existing &&
					existing.checksum === doc.checksum &&
					collectionsEqual(existing.collections ?? [], collections)
				) {
					newManifest[doc.summaryId] = existing;
					stats.unchanged++;
					continue;
				}

				// Content or collections changed — materialize and write
				const materialized = materialize(doc);
				const primaryPath = `${docsRoot}/${materialized.relativePath}`;
				writeFile(primaryPath, materialized.content);

				// Remove old collection copies that are no longer needed
				if (existing?.collections) {
					for (const oldCol of existing.collections) {
						if (!collections.includes(oldCol)) {
							deleteFile(
								collectionPath(docsRoot, oldCol, existing.relativePath),
							);
						}
					}
				}

				// Write current collection copies
				for (const colId of collections) {
					writeFile(
						collectionPath(docsRoot, colId, materialized.relativePath),
						materialized.content,
					);
				}

				newManifest[doc.summaryId] = {
					checksum: doc.checksum,
					relativePath: materialized.relativePath,
					collections,
				};

				stats[existing ? "updated" : "created"]++;
			}

			if (nextCursor !== null && nextCursor !== undefined) {
				cursor = nextCursor;
			} else {
				hasMore = false;
			}
		}

		// Delete files for summaryIds in old manifest but not in new
		for (const [summaryId, entry] of Object.entries(manifest)) {
			if (!newManifest[summaryId]) {
				deleteFile(`${docsRoot}/${entry.relativePath}`);
				for (const colId of entry.collections ?? []) {
					deleteFile(collectionPath(docsRoot, colId, entry.relativePath));
				}
				stats.deleted++;
			}
		}

		saveManifest(docsRoot, newManifest);

		const documentCount = stats.created + stats.updated + stats.unchanged;
		writeStatus({
			status: "ready",
			documentCount,
			...stats,
		});
	} catch (err) {
		writeStatus({ status: "error", message: `Sync failed: ${err.message}` });
		process.exit(1);
	}
}

main();
