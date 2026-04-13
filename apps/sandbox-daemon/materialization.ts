/**
 * Materialized filesystem layout with per-scope directories.
 *
 * Layout:
 *   /workspace/data/{userId}/
 *   ├── canonical/{type}/{documentId}.md       # Real files. Agent cwd for scope=global.
 *   │                                          # Frontmatter: title, cite, collections (names).
 *   ├── canonical/.manifest.json               # Reconciliation state (checksum, collections IDs).
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
	title?: string;
}

/** Identifies a document for filesystem operations. */
export interface DocIdentifier {
	document_id: string;
	type: number;
}

/**
 * In-memory representation of a document's metadata.
 * Stored in .manifest.json for reconciliation; the DB manifest returns
 * the same shape after normalization.
 */
export interface LocalManifestEntry {
	document_id: string;
	type: number;
	checksum: string;
	collections: string[];
	title?: string;
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
 * Build the pre-computed citation path for a document.
 * Type 3 (notes) → `notes/3/{id}`, all others → `detail/{type}/{id}`.
 */
export function buildCitePath(doc: DocIdentifier): string {
	return doc.type === 3
		? `notes/3/${doc.document_id}`
		: `detail/${doc.type}/${doc.document_id}`;
}

/**
 * Write a document to canonical/ with agent-facing frontmatter.
 * Reconciliation state (checksum, collection IDs) lives in .manifest.json,
 * not in frontmatter.
 */
export function writeCanonicalFile(
	dataRoot: string,
	doc: DocFile,
	collectionNames: Map<string, string>,
): void {
	const filePath = buildCanonicalPath(dataRoot, doc);
	// Strip newlines/carriage returns to prevent title from breaking frontmatter.
	const title = (doc.title ?? doc.document_id).replace(/[\r\n]+/g, " ").trim();
	const cite = buildCitePath(doc);
	const lines = ["---", `title: ${title}`, `cite: ${cite}`];
	if (doc.collections.length > 0) {
		const names = doc.collections.map(
			(id) => collectionNames.get(id) ?? id,
		);
		lines.push(`collections: ${JSON.stringify(names)}`);
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
 * Remove collection hardlinks for a specific document across one or more collection IDs.
 */
export function removeCollectionEntries(
	dataRoot: string,
	doc: DocIdentifier,
	collectionIds: string[],
): void {
	for (const colId of collectionIds) {
		try {
			unlinkSync(buildCollectionLinkPath(dataRoot, doc, colId));
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

const MANIFEST_FILENAME = ".manifest.json";

/**
 * Persisted reconciliation state: document entries + collection name snapshot.
 * Collection names are stored so renames can be detected even when document
 * manifests are unchanged.
 */
export interface ManifestData {
	entries: LocalManifestEntry[];
	collectionNames: Record<string, string>;
}

function emptyManifest(): ManifestData {
	return { entries: [], collectionNames: {} };
}

/**
 * Read the local manifest from `canonical/.manifest.json`.
 * Returns empty ManifestData if the file is missing or malformed.
 */
export async function readManifest(
	dataRoot: string,
): Promise<ManifestData> {
	const filePath = `${dataRoot}/canonical/${MANIFEST_FILENAME}`;
	try {
		const text = await Bun.file(filePath).text();
		const parsed = JSON.parse(text);
		if (
			!parsed ||
			typeof parsed !== "object" ||
			!Array.isArray(parsed.entries)
		) {
			return emptyManifest();
		}
		return {
			entries: parsed.entries,
			collectionNames: parsed.collectionNames ?? {},
		};
	} catch {
		return emptyManifest();
	}
}

/**
 * Write the local manifest to `canonical/.manifest.json`.
 */
export async function writeManifest(
	dataRoot: string,
	data: ManifestData,
): Promise<void> {
	const filePath = `${dataRoot}/canonical/${MANIFEST_FILENAME}`;
	ensureParentDir(filePath);
	await Bun.write(filePath, JSON.stringify(data));
}

/**
 * Generate `canonical/_index.md` — a collection-organized directory of all
 * documents. The agent reads this optionally when browsing or discovering
 * documents, not as a mandatory first step.
 */
export async function writeIndexFile(
	dataRoot: string,
	entries: LocalManifestEntry[],
	collectionNames: Map<string, string>,
): Promise<void> {
	const lines: string[] = ["# Collections", ""];

	// Group entries by collection.
	const collectionMap = new Map<string, LocalManifestEntry[]>();
	const uncategorized: LocalManifestEntry[] = [];
	for (const entry of entries) {
		if (entry.collections.length === 0) {
			uncategorized.push(entry);
		} else {
			for (const colId of entry.collections) {
				let list = collectionMap.get(colId);
				if (!list) {
					list = [];
					collectionMap.set(colId, list);
				}
				list.push(entry);
			}
		}
	}

	// Sort collections alphabetically by name for natural browsing.
	const sortedCollections = [...collectionMap.entries()].sort((a, b) => {
		const nameA = collectionNames.get(a[0]) ?? a[0];
		const nameB = collectionNames.get(b[0]) ?? b[0];
		return nameA.localeCompare(nameB);
	});

	function formatDocLine(doc: LocalManifestEntry): string {
		const title = doc.title ?? doc.document_id;
		return `- ${title} (${doc.type}/${sanitizePathSegment(doc.document_id)}.md)`;
	}

	for (const [colId, docs] of sortedCollections) {
		const colName = collectionNames.get(colId) ?? colId;
		lines.push(`## ${colName} (${colId})`, "");
		for (const doc of docs) {
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
