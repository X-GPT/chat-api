/**
 * Materialized filesystem layout with per-scope directories.
 *
 * Layout:
 *   /workspace/data/{userId}/
 *   ├── canonical/{type}/{documentId}.md       # Real files. Agent cwd for scope=global.
 *   │                                          # Frontmatter: title, cite.
 *   │                                          # File mtime = user_files.updated_at (sync marker).
 *   ├── canonical/_index.md                    # Collection-browsing directory.
 *   │                                          # File mtime = max(file_collection_relationship.updated_at).
 *   ├── collections/{collectionId}/{type}/{documentId}.md
 *   │                                          # HARDLINKS to canonical inodes. Agent cwd
 *   │                                          # for scope=collection.
 *   └── scopes/
 *       └── request-{summaryId}/
 *           └── doc.md                         # HARDLINK to canonical. Agent cwd for
 *                                              # scope=document.
 *
 * The agent's search surface contains only real files and hardlinks — no symlinks —
 * because ripgrep skips symlinks during recursive traversal by default and the
 * Claude Code Grep tool does not pass --follow.
 */

import { createHash } from "node:crypto";
import {
	existsSync,
	linkSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
	unlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { ensureParentDir } from "./fs-utils";
import type { DocMetaRow, MembershipRow } from "./queries";

export interface DocFile {
	document_id: string;
	type: number;
	content: string;
	title?: string | null;
}

/** Identifies a document for filesystem operations. */
export interface DocIdentifier {
	document_id: string;
	type: number;
}

export function sanitizePathSegment(value: string): string {
	return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "unknown";
}

export function computeChecksum(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

export function getDataRoot(userId: string): string {
	return `/workspace/data/${sanitizePathSegment(userId)}`;
}

/**
 * Ensure the minimum directory structure exists for a user's data root.
 * Idempotent — safe to call on every turn.
 */
export function ensureDataRoot(dataRoot: string): void {
	mkdirSync(`${dataRoot}/canonical`, { recursive: true });
}

/**
 * Wipe canonical/ and collections/ for a full reset.
 * Not used on the happy path — kept for explicit repair or test setup.
 */
export function clearDataRoot(dataRoot: string): void {
	rmSync(`${dataRoot}/canonical`, { recursive: true, force: true });
	rmSync(`${dataRoot}/collections`, { recursive: true, force: true });
	ensureDataRoot(dataRoot);
}

export function buildCanonicalPath(
	dataRoot: string,
	doc: DocIdentifier,
): string {
	return `${dataRoot}/canonical/${doc.type}/${sanitizePathSegment(doc.document_id)}.md`;
}

/**
 * Build the pre-computed citation path for a document.
 * Type 3 (notes) → `notes/3/{id}`, all others → `detail/{type}/{id}`.
 */
export function buildCitePath(doc: DocIdentifier): string {
	return doc.type === 3
		? `notes/3/${doc.document_id}`
		: `detail/${doc.type}/${doc.document_id}`;
}

/**
 * Convert a DB TIMESTAMP string to whole seconds since epoch.
 * Both sides of the sync comparison truncate to seconds to match filesystem
 * mtime precision on macOS/HFS+ and MySQL's default TIMESTAMP(0).
 */
export function toEpochSeconds(updatedAt: string): number {
	return Math.floor(Date.parse(updatedAt) / 1000);
}

/**
 * Stamp a file's mtime and atime to the given DB timestamp (second precision).
 * The file's mtime thus encodes "last synced updated_at" — no separate marker
 * file is needed.
 */
export function stampMtime(path: string, updatedAt: string): void {
	stampMtimeSeconds(path, toEpochSeconds(updatedAt));
}

/**
 * Stamp a file's mtime and atime to a specific epoch-seconds value.
 * Used when the stamp source is already numeric (e.g., max(updated_at) across rows).
 */
export function stampMtimeSeconds(path: string, epochSec: number): void {
	utimesSync(path, epochSec, epochSec);
}

/**
 * Return a file's mtime truncated to whole seconds, or null if missing.
 */
export function getMtimeSeconds(path: string): number | null {
	try {
		return Math.floor(statSync(path).mtimeMs / 1000);
	} catch {
		return null;
	}
}

/**
 * Write a document to canonical/ with agent-facing frontmatter.
 * Only title + cite live in frontmatter; membership and sync state are tracked
 * elsewhere (hardlinks under collections/ and the file's own mtime).
 */
export function writeCanonicalFile(dataRoot: string, doc: DocFile): void {
	const filePath = buildCanonicalPath(dataRoot, doc);
	const title = doc.title ?? doc.document_id;
	const cite = buildCitePath(doc);
	const body = [
		"---",
		`title: ${JSON.stringify(title)}`,
		`cite: ${cite}`,
		"---",
		"",
		doc.content,
		"",
	].join("\n");

	ensureParentDir(filePath);
	writeFileSync(filePath, body, "utf-8");
}

/**
 * Remove a document from canonical/.
 */
export function removeCanonicalFile(
	dataRoot: string,
	doc: DocIdentifier,
): void {
	const filePath = buildCanonicalPath(dataRoot, doc);
	try {
		unlinkSync(filePath);
	} catch {
		// File may not exist
	}
}

function buildCollectionLinkPath(
	dataRoot: string,
	doc: DocIdentifier,
	collectionId: string,
): string {
	return `${dataRoot}/collections/${sanitizePathSegment(collectionId)}/${doc.type}/${sanitizePathSegment(doc.document_id)}.md`;
}

/**
 * Create a hardlink in collections/{collectionId}/{type}/{documentId}.md pointing
 * at the same inode as the canonical file. ripgrep sees hardlinks as regular
 * files (no traversal filter applies).
 */
export function buildCollectionHardlink(
	dataRoot: string,
	doc: DocIdentifier,
	collectionId: string,
): void {
	const linkPath = buildCollectionLinkPath(dataRoot, doc, collectionId);
	const targetPath = buildCanonicalPath(dataRoot, doc);

	ensureParentDir(linkPath);

	try {
		unlinkSync(linkPath);
	} catch {
		// May not exist
	}
	linkSync(targetPath, linkPath);
}

/**
 * Remove a single collection hardlink for the given document and collection.
 */
export function removeCollectionHardlink(
	dataRoot: string,
	doc: DocIdentifier,
	collectionId: string,
): void {
	try {
		unlinkSync(buildCollectionLinkPath(dataRoot, doc, collectionId));
	} catch {
		// May not exist
	}
}

/**
 * Create an ephemeral single-document scope for document-scoped turns.
 * The returned path is the agent's cwd, containing one hardlink named doc.md
 * that points at the canonical inode.
 */
export function createEphemeralDocumentScope(
	dataRoot: string,
	summaryId: string,
	doc: DocIdentifier,
): string {
	const sanitizedId = sanitizePathSegment(summaryId);
	const scopePath = `${dataRoot}/scopes/request-${sanitizedId}`;
	mkdirSync(scopePath, { recursive: true });

	const canonicalPath = buildCanonicalPath(dataRoot, doc);
	const linkPath = `${scopePath}/doc.md`;

	try {
		unlinkSync(linkPath);
	} catch {
		// May not exist
	}
	linkSync(canonicalPath, linkPath);

	return scopePath;
}

/**
 * Remove an ephemeral document scope.
 */
export function removeEphemeralDocumentScope(
	dataRoot: string,
	summaryId: string,
): void {
	const sanitizedId = sanitizePathSegment(summaryId);
	const scopePath = `${dataRoot}/scopes/request-${sanitizedId}`;
	rmSync(scopePath, { recursive: true, force: true });
}

/**
 * Resolve the absolute path for an agent's cwd based on scope.
 * Global and collection scopes point directly at real directories (no symlinks).
 * Document scope points at the ephemeral hardlink dir created per turn.
 */
export function resolveScopeCwd(
	dataRoot: string,
	scopeType: "global" | "collection" | "document",
	scopeId?: string,
): string {
	switch (scopeType) {
		case "global":
			return `${dataRoot}/canonical`;
		case "collection":
			if (!scopeId) return `${dataRoot}/canonical`;
			return `${dataRoot}/collections/${sanitizePathSegment(scopeId)}`;
		case "document":
			if (!scopeId) return `${dataRoot}/canonical`;
			return `${dataRoot}/scopes/request-${sanitizePathSegment(scopeId)}`;
	}
}

/**
 * Walk canonical/{type}/*.md and return identifiers for every materialized doc.
 * Used by reconcile's orphan cleanup pass.
 */
export function scanCanonicalFiles(dataRoot: string): DocIdentifier[] {
	const root = `${dataRoot}/canonical`;
	if (!existsSync(root)) return [];
	const out: DocIdentifier[] = [];
	for (const typeDir of readdirSync(root, { withFileTypes: true })) {
		if (!typeDir.isDirectory()) continue;
		const type = Number(typeDir.name);
		if (Number.isNaN(type)) continue;
		for (const file of readdirSync(`${root}/${typeDir.name}`, {
			withFileTypes: true,
		})) {
			if (!file.isFile() || !file.name.endsWith(".md")) continue;
			out.push({
				document_id: file.name.slice(0, -3),
				type,
			});
		}
	}
	return out;
}

export interface CollectionLinkIdentifier extends DocIdentifier {
	collection_id: string;
}

/**
 * Walk collections/*\/*\/*.md and return identifiers for every hardlink.
 * Used by reconcile's hardlink existence-diff.
 */
export function scanCollectionLinks(
	dataRoot: string,
): CollectionLinkIdentifier[] {
	const root = `${dataRoot}/collections`;
	if (!existsSync(root)) return [];
	const out: CollectionLinkIdentifier[] = [];
	for (const colDir of readdirSync(root, { withFileTypes: true })) {
		if (!colDir.isDirectory()) continue;
		const colPath = `${root}/${colDir.name}`;
		for (const typeDir of readdirSync(colPath, { withFileTypes: true })) {
			if (!typeDir.isDirectory()) continue;
			const type = Number(typeDir.name);
			if (Number.isNaN(type)) continue;
			for (const file of readdirSync(`${colPath}/${typeDir.name}`, {
				withFileTypes: true,
			})) {
				if (!file.isFile() || !file.name.endsWith(".md")) continue;
				out.push({
					collection_id: colDir.name,
					type,
					document_id: file.name.slice(0, -3),
				});
			}
		}
	}
	return out;
}

/**
 * Find a canonical document by ID without parsing frontmatter. Scans
 * canonical/{type}/ subdirectories for a filename matching document_id.
 * Returns the DocIdentifier (document_id + type) or null if not found.
 */
export function findCanonicalDoc(
	dataRoot: string,
	documentId: string,
): DocIdentifier | null {
	const root = `${dataRoot}/canonical`;
	if (!existsSync(root)) return null;
	const sanitized = sanitizePathSegment(documentId);
	for (const typeDir of readdirSync(root, { withFileTypes: true })) {
		if (!typeDir.isDirectory()) continue;
		const type = Number(typeDir.name);
		if (Number.isNaN(type)) continue;
		const path = `${root}/${typeDir.name}/${sanitized}.md`;
		if (existsSync(path)) {
			return { document_id: documentId, type };
		}
	}
	return null;
}

/**
 * Generate `canonical/_index.md` — a collection-organized directory of all
 * documents. Collection names come from membership rows (denormalized), so no
 * separate name lookup is required.
 */
export async function writeIndexFile(
	dataRoot: string,
	docs: DocMetaRow[],
	memberships: MembershipRow[],
): Promise<void> {
	const lines: string[] = ["# Collections", ""];

	// Look up titles/types by document_id.
	const docMap = new Map(docs.map((d) => [d.document_id, d]));

	// Group memberships by collection (collection_id → { name, docs }).
	const colMap = new Map<
		string,
		{ name: string; docs: DocMetaRow[] }
	>();
	const categorizedDocIds = new Set<string>();
	for (const m of memberships) {
		const doc = docMap.get(m.document_id);
		if (!doc) continue; // membership for a deleted doc — skip
		categorizedDocIds.add(m.document_id);
		let entry = colMap.get(m.collection_id);
		if (!entry) {
			entry = { name: m.collection_name, docs: [] };
			colMap.set(m.collection_id, entry);
		}
		entry.docs.push(doc);
	}

	const uncategorized = docs.filter((d) => !categorizedDocIds.has(d.document_id));

	const sortedCollections = [...colMap.entries()].sort((a, b) =>
		a[1].name.localeCompare(b[1].name),
	);

	function stripNewlines(s: string): string {
		return s.replace(/[\r\n]+/g, " ");
	}

	function formatDocLine(doc: DocMetaRow): string {
		const title = stripNewlines(doc.title ?? doc.document_id);
		return `- ${title} (${doc.type}/${sanitizePathSegment(doc.document_id)}.md)`;
	}

	for (const [colId, { name, docs: colDocs }] of sortedCollections) {
		lines.push(`## ${stripNewlines(name)} (${colId})`, "");
		for (const doc of colDocs) {
			lines.push(formatDocLine(doc));
		}
		lines.push("");
	}

	if (uncategorized.length > 0) {
		lines.push("## Uncategorized", "");
		for (const doc of uncategorized) {
			lines.push(formatDocLine(doc));
		}
		lines.push("");
	}

	const filePath = `${dataRoot}/canonical/_index.md`;
	ensureParentDir(filePath);
	await Bun.write(filePath, lines.join("\n"));
}
