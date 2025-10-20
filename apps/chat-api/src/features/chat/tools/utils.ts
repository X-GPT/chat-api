import type { ProtectedFileMetadata } from "../api/types";

export function normalizeFiles(
	files: ProtectedFileMetadata[],
): ProtectedFileMetadata[] {
	return files.map((file) => {
		if (file.type === 3) {
			return {
				...file,
				fileName: `note-${file.summaryId}`,
				fileType: "text/html",
			};
		} else if (file.type === 6) {
			return {
				...file,
				fileName: `memocast-${file.summaryId}`,
				fileType: "audio/wav",
			};
		}
		return file;
	});
}

/**
 * Escapes special XML characters to prevent malformed XML output
 */
export function escapeXml(text: string | number): string {
	return String(text)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

type XmlContent = string | number | string[] | null | undefined;

interface XmlOptions {
	/** Indentation level (number of tabs). Defaults to 0 */
	indent?: number;
	/** Whether to escape content. Defaults to true */
	shouldEscape?: boolean;
	/** Whether content is already XML (skip escaping). Defaults to false */
	raw?: boolean;
}

/**
 * Helper function to construct XML strings with proper escaping and indentation
 *
 * @example
 * // Simple tag with text content
 * xml('name', 'John Doe')
 * // => '<name>John Doe</name>'
 *
 * @example
 * // Tag with nested content array
 * xml('user', [
 *   xml('id', 123),
 *   xml('name', 'John')
 * ], { indent: 1 })
 * // => Properly indented XML with nested tags
 *
 * @example
 * // Tag with raw XML content (no escaping)
 * xml('items', itemsXml, { raw: true })
 *
 * @example
 * // Disable automatic escaping
 * xml('text', 'Tom & Jerry', { shouldEscape: false })
 */
export function xml(
	tag: string,
	content?: XmlContent,
	options: XmlOptions = {},
): string {
	const { indent = 0, shouldEscape = true, raw = false } = options;
	const tabs = "\t".repeat(indent);

	// Handle empty/null content
	if (content === null || content === undefined || content === "") {
		return `${tabs}<${tag} />`;
	}

	// Handle array content (nested elements)
	if (Array.isArray(content)) {
		const hasContent = content.length > 0;
		if (!hasContent) {
			return `${tabs}<${tag} />`;
		}

		// Check if content needs newlines (multi-line nested content)
		const needsNewlines = content.some(
			(item) => item.includes("\n") || item.includes("\t"),
		);

		if (needsNewlines) {
			return `${tabs}<${tag}>\n${content.join("\n")}\n${tabs}</${tag}>`;
		}
		return `${tabs}<${tag}>${content.join("")}</${tag}>`;
	}

	// Handle string/number content
	const processedContent = raw
		? String(content)
		: shouldEscape
			? escapeXml(content)
			: String(content);

	// Single line output
	return `${tabs}<${tag}>${processedContent}</${tag}>`;
}
