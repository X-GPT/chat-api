/**
 * Materialized filesystem layout with per-scope directories.
 *
 * Layout:
 *   /workspace/data/{userId}/
 *   ├── canonical/{type}/{documentId}.md       # Real files. Agent cwd for scope=global.
 *   │                                          # Frontmatter carries all per-file metadata
 *   │                                          # (summaryId, type, checksum, collections).
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
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { ensureParentDir } from "./fs-utils";

export interface DocFile {
	document_id: string;
	type: number;
	collections: string[];
	content: string;
	checksum: string;
}

/** Identifies a document for filesystem operations. */
export interface DocIdentifier {
	document_id: string;
	type: number;
}

/**
 * In-memory representation of a document's metadata, matching what the
 * frontmatter carries and what the DB manifest returns after normalization.
 */
export interface LocalManifestEntry {
	document_id: string;
	type: number;
	checksum: string;
	collections: string[];
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

export function buildCanonicalPath(
	dataRoot: string,
	doc: DocIdentifier,
): string {
	return `${dataRoot}/canonical/${doc.type}/${sanitizePathSegment(doc.document_id)}.md`;
}

/**
 * Parse a comma-separated path_key into a trimmed, non-empty list of collection IDs.
 * Empty string and all-whitespace yield `[]`.
 */
export function parseCollectionIds(pathKey: string): string[] {
	if (!pathKey) return [];
	return pathKey
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean);
}

/**
 * Write a document to canonical/ with frontmatter carrying all per-file metadata.
 * The frontmatter IS the manifest — reconcile derives its local state by re-reading
 * these files, no separate cache.
 */
export function writeCanonicalFile(dataRoot: string, doc: DocFile): void {
	const filePath = buildCanonicalPath(dataRoot, doc);
	const lines = [
		"---",
		`summaryId: ${doc.document_id}`,
		`type: ${doc.type}`,
		`checksum: ${doc.checksum}`,
	];
	if (doc.collections.length > 0) {
		// JSON-style array on one line so grep/regex can reliably match it.
		lines.push(`collections: ${JSON.stringify(doc.collections)}`);
	}
	lines.push("---", "", doc.content, "");

	ensureParentDir(filePath);
	writeFileSync(filePath, lines.join("\n"), "utf-8");
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
	const linkPath = `${dataRoot}/collections/${sanitizePathSegment(collectionId)}/${doc.type}/${sanitizePathSegment(doc.document_id)}.md`;
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
 * Remove collection hardlinks for a specific document across one or more collection IDs.
 */
export function removeCollectionEntries(
	dataRoot: string,
	doc: DocIdentifier,
	collectionIds: string[],
): void {
	for (const colId of collectionIds) {
		const linkPath = `${dataRoot}/collections/${sanitizePathSegment(colId)}/${doc.type}/${sanitizePathSegment(doc.document_id)}.md`;
		try {
			unlinkSync(linkPath);
		} catch {
			// May not exist
		}
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
 * Find a canonical document by ID without parsing frontmatter. Scans
 * canonical/{type}/ subdirectories for a filename matching document_id.
 * Returns the DocIdentifier (document_id + type) or null if not found.
 *
 * O(#type_dirs) existsSync calls — much cheaper than deriveLocalManifest +
 * find when the caller only needs one document (e.g. the document-scope
 * turn handler).
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
 * Walk canonical/{type}/*.md and return a LocalManifestEntry for each file,
 * sorted by document_id to match the remote manifest's ordering. Skips files
 * whose frontmatter can't be parsed (logs a warning via the provided logger).
 *
 * File reads run in parallel via Promise.all so the wall-clock cost scales
 * with the slowest file, not the sum. Each file reads only the first 2KB
 * via Bun.file().slice() — enough to cover any realistic frontmatter.
 */
export async function deriveLocalManifest(
	dataRoot: string,
	logger?: { warn: (msg: Record<string, unknown>) => void },
): Promise<LocalManifestEntry[]> {
	const root = `${dataRoot}/canonical`;
	if (!existsSync(root)) return [];

	// Collect candidate paths synchronously (readdir is cheap).
	const paths: string[] = [];
	for (const typeDir of readdirSync(root, { withFileTypes: true })) {
		if (!typeDir.isDirectory()) continue;
		if (Number.isNaN(Number(typeDir.name))) continue;
		const subRoot = `${root}/${typeDir.name}`;
		for (const file of readdirSync(subRoot, { withFileTypes: true })) {
			if (!file.isFile() || !file.name.endsWith(".md")) continue;
			paths.push(`${subRoot}/${file.name}`);
		}
	}

	const parsed = await Promise.all(paths.map((p) => parseFrontmatter(p)));

	const entries: LocalManifestEntry[] = [];
	for (let i = 0; i < parsed.length; i++) {
		const entry = parsed[i];
		if (entry) {
			entries.push(entry);
		} else if (logger) {
			logger.warn({ msg: "Skipped malformed frontmatter", path: paths[i] });
		}
	}
	entries.sort((a, b) =>
		a.document_id < b.document_id ? -1 : a.document_id > b.document_id ? 1 : 0,
	);
	return entries;
}

/**
 * Read a canonical file's frontmatter and return its manifest entry.
 * Returns null if the file can't be read or the frontmatter is malformed.
 */
export async function parseFrontmatter(
	path: string,
): Promise<LocalManifestEntry | null> {
	let head: string;
	try {
		// Partial read — Bun.file.slice().text() only reads the requested byte
		// range from disk, not the whole file. 2KB is well beyond any realistic
		// frontmatter size.
		head = await Bun.file(path).slice(0, 2048).text();
	} catch {
		return null;
	}

	// Frontmatter is bounded by two "---" lines at the very top of the file.
	const match = head.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return null;
	const body = match[1] ?? "";

	const docId = body.match(/^summaryId:\s*(.+)$/m)?.[1]?.trim();
	const typeStr = body.match(/^type:\s*(\d+)$/m)?.[1];
	const checksum = body.match(/^checksum:\s*(.+)$/m)?.[1]?.trim();
	const collectionsLine = body.match(/^collections:\s*(\[.*?\])$/m)?.[1];

	if (!docId || !typeStr || !checksum) return null;

	let collections: string[] = [];
	if (collectionsLine) {
		try {
			const parsed = JSON.parse(collectionsLine);
			if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string"))
				return null;
			collections = parsed;
		} catch {
			return null;
		}
	}

	return {
		document_id: docId,
		type: Number(typeStr),
		checksum,
		collections,
	};
}
