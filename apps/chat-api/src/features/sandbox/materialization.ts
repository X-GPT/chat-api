import type { ProtectedSummary } from "@/features/chat/api/types";

export interface MaterializedFile {
	summaryId: string;
	type: number;
	/** Full sandbox path */
	path: string;
	/** Path relative to docs root */
	relativePath: string;
	/** Frontmatter + body content ready to write to disk */
	content: string;
	/** SHA-256 hex checksum of content */
	checksum: string;
}

export interface MaterializationConfig {
	/** Sandbox workspace root, e.g. "/workspace/sandbox-prototype" */
	workspaceRoot: string;
	userId: string;
	/** Map of summaryId → collectionIds the summary belongs to. Optional. */
	collectionMap?: Map<string, string[]>;
}

/**
 * Sanitize a value for use as a filesystem path segment.
 * Extracted from scripts/run-sandbox-prototype.ts.
 */
export function sanitizePathSegment(value: string): string {
	return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "unknown";
}

/** Compute SHA-256 hex checksum of content using Bun's crypto. */
export function computeChecksum(content: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(content);
	return hasher.digest("hex");
}

/**
 * Determine the source kind from a ProtectedSummary.
 * - PDFs and links use parsed content → "parser_output"
 * - Notes (type 3) are typically markdown → "markdown"
 * - Everything else → "text"
 */
export function resolveSourceKind(
	summary: ProtectedSummary,
): "markdown" | "text" | "parser_output" {
	const fileType = summary.fileType;

	if (
		fileType === "application/pdf" ||
		fileType === "link/normal" ||
		fileType === "link/video"
	) {
		return "parser_output";
	}

	if (summary.type === 3) {
		return "markdown";
	}

	return "text";
}

/**
 * Extract the best available text content from a ProtectedSummary.
 * Prefers parseContent for file types that have parsed output,
 * falls back to content, then empty string.
 */
export function resolveContent(summary: ProtectedSummary): string {
	const sourceKind = resolveSourceKind(summary);

	if (sourceKind === "parser_output") {
		return summary.parseContent ?? summary.content ?? "";
	}

	return summary.content ?? summary.parseContent ?? "";
}

/** Build the docs root path for a user within the workspace. */
export function getDocsRoot(config: MaterializationConfig): string {
	return `${config.workspaceRoot}/docs/${sanitizePathSegment(config.userId)}`;
}

/**
 * Materialize a single ProtectedSummary into a file with YAML frontmatter.
 * Format matches the prototype in scripts/run-sandbox-prototype.ts.
 */
export function materializeSummary(
	summary: ProtectedSummary,
	config: MaterializationConfig,
): MaterializedFile {
	const summaryId = summary.id;
	const type = summary.type ?? 0;
	const docsRoot = getDocsRoot(config);
	const relativePath = `${type}/${sanitizePathSegment(summaryId)}.txt`;
	const sourceKind = resolveSourceKind(summary);
	const title = summary.title?.trim() ?? summary.summaryTitle?.trim() ?? "";
	const body = resolveContent(summary).trim();

	const content = [
		"---",
		`summaryId: ${summaryId}`,
		`type: ${type}`,
		`sourceKind: ${sourceKind}`,
		`title: ${JSON.stringify(title)}`,
		"---",
		"",
		body,
		"",
	].join("\n");

	return {
		summaryId,
		type,
		path: `${docsRoot}/${relativePath}`,
		relativePath,
		content,
		checksum: computeChecksum(content),
	};
}

/** Batch materialization of multiple summaries. */
export function materializeSummaries(
	summaries: ProtectedSummary[],
	config: MaterializationConfig,
): MaterializedFile[] {
	return summaries.map((summary) => materializeSummary(summary, config));
}

/**
 * Build collection directory paths for a given docs root.
 * Returns the path: {docsRoot}/collections/{collectionId}
 */
export function getCollectionDocsRoot(
	docsRoot: string,
	collectionId: string,
): string {
	return `${docsRoot}/collections/${sanitizePathSegment(collectionId)}`;
}

/**
 * Generate collection directory copies of materialized files.
 *
 * For each summary that has collections in the collectionMap,
 * creates a MaterializedFile entry for each collection directory.
 * Content is identical to the primary file (same frontmatter + body).
 *
 * Returns only the collection copies — primary files are not included.
 */
export function materializeCollectionCopies(
	summaries: ProtectedSummary[],
	config: MaterializationConfig,
): MaterializedFile[] {
	const { collectionMap } = config;
	if (!collectionMap || collectionMap.size === 0) return [];

	const copies: MaterializedFile[] = [];
	const docsRoot = getDocsRoot(config);

	for (const summary of summaries) {
		const collectionIds = collectionMap.get(summary.id);
		if (!collectionIds || collectionIds.length === 0) continue;

		// Materialize the file once to get its content
		const primary = materializeSummary(summary, config);

		for (const collectionId of collectionIds) {
			const collectionRoot = getCollectionDocsRoot(docsRoot, collectionId);
			const collectionPath = `${collectionRoot}/${primary.relativePath}`;

			copies.push({
				summaryId: primary.summaryId,
				type: primary.type,
				path: collectionPath,
				relativePath: `collections/${sanitizePathSegment(collectionId)}/${primary.relativePath}`,
				content: primary.content,
				checksum: primary.checksum,
			});
		}
	}

	return copies;
}
