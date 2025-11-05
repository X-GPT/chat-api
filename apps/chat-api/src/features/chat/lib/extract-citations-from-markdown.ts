// Extract reference identifiers from markdown text
export function extractReferencesFromText(
	markdownText: string,
): Array<{ id: string; type: number; index: number }> {
	if (!markdownText) return [];

	const references: Array<{ id: string; type: number; index: number }> = [];
	const referencePattern = /\[c\d+\]:\s*(\d+)\/(\d+)/g;
	const seen = new Set<string>();

	let match: RegExpExecArray | null;
	match = referencePattern.exec(markdownText);
	while (match !== null) {
		const index = parseInt(match[0].slice(1), 10) ?? 0;
		const type = parseInt(match[1] ?? "0", 10) ?? 0;
		const id = match[2] ?? "";
		const key = `${type}/${id}`;

		if (!seen.has(key) && id) {
			seen.add(key);
			references.push({ id, type, index });
		}
		match = referencePattern.exec(markdownText);
	}

	return references;
}
