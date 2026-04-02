import { dirname, relative } from "node:path";
import type { ProtectedSummary } from "@/features/chat/api/types";

export interface SyncLogger {
	info(obj: Record<string, unknown>): void;
	error(obj: Record<string, unknown>): void;
}

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

export interface CollectionSymlink {
	/** Path relative to docs root, e.g. "collections/col-A/0/abc.txt" */
	relativePath: string;
	/** Relative symlink target, e.g. "../../../0/abc.txt" */
	target: string;
}

export function sanitizePathSegment(value: string): string {
	return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "unknown";
}

export function computeChecksum(content: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(content);
	return hasher.digest("hex");
}

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
 * Build collection directory path: {docsRoot}/collections/{collectionId}
 */
export function getCollectionDocsRoot(
	docsRoot: string,
	collectionId: string,
): string {
	return `${docsRoot}/collections/${sanitizePathSegment(collectionId)}`;
}

/**
 * Generate symlink entries for collection copies.
 * Each symlink points from collections/{collectionId}/{type}/{id}.txt
 * back to the primary file at {type}/{id}.txt via a relative path.
 *
 * Accepts either full ProtectedSummary objects or minimal {id, type} objects.
 */
export function resolveCollectionSymlinks(
	summaries: ReadonlyArray<{ id: string; type?: number | null }>,
	config: MaterializationConfig,
): CollectionSymlink[] {
	const { collectionMap } = config;
	if (!collectionMap || collectionMap.size === 0) return [];

	const symlinks: CollectionSymlink[] = [];

	for (const summary of summaries) {
		const collectionIds = collectionMap.get(summary.id);
		if (!collectionIds || collectionIds.length === 0) continue;

		const type = summary.type ?? 0;
		const primaryRelPath = `${type}/${sanitizePathSegment(summary.id)}.txt`;

		for (const collectionId of collectionIds) {
			const linkRelPath = `collections/${sanitizePathSegment(collectionId)}/${primaryRelPath}`;
			const target = relative(dirname(linkRelPath), primaryRelPath);

			symlinks.push({ relativePath: linkRelPath, target });
		}
	}

	return symlinks;
}
