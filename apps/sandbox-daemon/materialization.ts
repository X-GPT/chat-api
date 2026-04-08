/**
 * Materialized filesystem layout with scope views.
 *
 * Layout:
 *   /workspace/data/{userId}/
 *   ├── canonical/{type}/{documentId}.md          # Primary file copies (keyed by document_id)
 *   ├── collections/{collectionId}/{type}/{documentId}.md  # Symlinks → canonical
 *   ├── indexes/collections/{collectionId}.md     # Collection index files
 *   └── scopes/
 *       ├── global/
 *       │   ├── docs -> ../../canonical
 *       │   └── collections -> ../../indexes/collections
 *       ├── collection-{collectionId}/
 *       │   └── docs -> ../../collections/{collectionId}
 *       └── request-{summaryId}/
 *           └── doc.md -> ../../canonical/{type}/{documentId}.md
 */

import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, relative } from "node:path";
import { ensureParentDir } from "./fs-utils";

export interface DocFile {
	document_id: string;
	type: number;
	slug: string;
	path_key: string;
	content: string;
	checksum: string;
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

export function buildCanonicalPath(
	dataRoot: string,
	doc: DocIdentifier,
): string {
	return `${dataRoot}/canonical/${doc.type}/${sanitizePathSegment(doc.document_id)}.md`;
}

/**
 * Write a document to canonical/ with frontmatter.
 */
export function writeCanonicalFile(dataRoot: string, doc: DocFile): void {
	const filePath = buildCanonicalPath(dataRoot, doc);
	const content = [
		"---",
		`summaryId: ${doc.document_id}`,
		`type: ${doc.type}`,
		`title: ${JSON.stringify(doc.slug)}`,
		"---",
		"",
		doc.content,
		"",
	].join("\n");

	ensureParentDir(filePath);
	writeFileSync(filePath, content, "utf-8");
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
 * Create a symlink in collections/{collectionId}/{type}/{documentId}.md → canonical.
 */
export function buildCollectionSymlink(
	dataRoot: string,
	doc: DocIdentifier,
	collectionId: string,
): void {
	const linkPath = `${dataRoot}/collections/${sanitizePathSegment(collectionId)}/${doc.type}/${sanitizePathSegment(doc.document_id)}.md`;
	const targetPath = buildCanonicalPath(dataRoot, doc);
	const target = relative(dirname(linkPath), targetPath);

	ensureParentDir(linkPath);

	try {
		unlinkSync(linkPath);
	} catch {
		// May not exist
	}

	symlinkSync(target, linkPath);
}

/**
 * Build a collection index file listing all documents in the collection.
 */
export function buildCollectionIndex(
	dataRoot: string,
	collectionId: string,
	docs: Array<{ document_id: string; type: number; slug: string }>,
): void {
	const indexPath = `${dataRoot}/indexes/collections/${sanitizePathSegment(collectionId)}.md`;
	const lines = [
		`# Collection: ${collectionId}`,
		"",
		...docs.map(
			(doc) =>
				`- [${doc.slug}](../../collections/${sanitizePathSegment(collectionId)}/${doc.type}/${sanitizePathSegment(doc.document_id)}.md)`,
		),
		"",
	];

	ensureParentDir(indexPath);
	writeFileSync(indexPath, lines.join("\n"), "utf-8");
}

/**
 * Remove a collection index file (when the collection becomes empty).
 */
export function removeCollectionIndex(
	dataRoot: string,
	collectionId: string,
): void {
	const indexPath = `${dataRoot}/indexes/collections/${sanitizePathSegment(collectionId)}.md`;
	try {
		unlinkSync(indexPath);
	} catch {
		// May not exist
	}
}

/**
 * Create/refresh scope symlink directories.
 */
export function buildScopeRoots(
	dataRoot: string,
	collectionIds: string[],
): void {
	const globalScope = `${dataRoot}/scopes/global`;
	mkdirSync(globalScope, { recursive: true });
	safeSymlink("../../canonical", `${globalScope}/docs`);
	safeSymlink("../../indexes/collections", `${globalScope}/collections`);

	for (const colId of collectionIds) {
		const sanitized = sanitizePathSegment(colId);
		const colScope = `${dataRoot}/scopes/collection-${sanitized}`;
		mkdirSync(colScope, { recursive: true });
		safeSymlink(`../../collections/${sanitized}`, `${colScope}/docs`);
	}

	const scopesDir = `${dataRoot}/scopes`;
	if (existsSync(scopesDir)) {
		const validScopeDirs = new Set([
			"global",
			...collectionIds.map((id) => `collection-${sanitizePathSegment(id)}`),
		]);
		for (const entry of readdirSync(scopesDir)) {
			if (entry.startsWith("collection-") && !validScopeDirs.has(entry)) {
				rmSync(`${scopesDir}/${entry}`, { recursive: true, force: true });
			}
		}
	}
}

/**
 * Create an ephemeral single-document scope for document-scoped turns.
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
	const target = relative(scopePath, canonicalPath);

	safeSymlink(target, linkPath);

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
 */
export function resolveScopeCwd(
	dataRoot: string,
	scopeType: "global" | "collection" | "document",
	scopeId?: string,
): string {
	switch (scopeType) {
		case "global":
			return `${dataRoot}/scopes/global`;
		case "collection":
			if (!scopeId) return `${dataRoot}/scopes/global`;
			return `${dataRoot}/scopes/collection-${sanitizePathSegment(scopeId)}`;
		case "document":
			if (!scopeId) return `${dataRoot}/scopes/global`;
			return `${dataRoot}/scopes/request-${sanitizePathSegment(scopeId)}`;
	}
}

function safeSymlink(target: string, linkPath: string): void {
	try {
		const existing = readlinkSync(linkPath);
		if (existing === target) return;
		unlinkSync(linkPath);
	} catch {
		try {
			unlinkSync(linkPath);
		} catch {
			// Doesn't exist
		}
	}
	symlinkSync(target, linkPath);
}

/**
 * Remove collection symlinks for a specific document.
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
