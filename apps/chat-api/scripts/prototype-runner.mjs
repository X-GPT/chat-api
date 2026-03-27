import { execFile } from "node:child_process";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

const requestPath = process.argv[2];
if (!requestPath) throw new Error("Request path argument is required");

const request = JSON.parse(await readFile(requestPath, "utf8"));
const now = () => Date.now();

/** Extract keywords from a query string (3+ chars, skip stop words). */
const STOP_WORDS = new Set([
	"the",
	"a",
	"an",
	"is",
	"are",
	"was",
	"were",
	"be",
	"been",
	"being",
	"have",
	"has",
	"had",
	"do",
	"does",
	"did",
	"will",
	"would",
	"could",
	"should",
	"may",
	"might",
	"shall",
	"can",
	"need",
	"dare",
	"ought",
	"used",
	"to",
	"of",
	"in",
	"for",
	"on",
	"with",
	"at",
	"by",
	"from",
	"as",
	"into",
	"through",
	"during",
	"before",
	"after",
	"above",
	"below",
	"between",
	"out",
	"off",
	"over",
	"under",
	"again",
	"further",
	"then",
	"once",
	"here",
	"there",
	"when",
	"where",
	"why",
	"how",
	"all",
	"each",
	"every",
	"both",
	"few",
	"more",
	"most",
	"other",
	"some",
	"such",
	"no",
	"nor",
	"not",
	"only",
	"own",
	"same",
	"so",
	"than",
	"too",
	"very",
	"just",
	"because",
	"but",
	"and",
	"or",
	"if",
	"while",
	"about",
	"what",
	"which",
	"who",
	"whom",
	"this",
	"that",
	"these",
	"those",
	"i",
	"me",
	"my",
	"we",
	"our",
	"you",
	"your",
	"he",
	"him",
	"his",
	"she",
	"her",
	"it",
	"its",
	"they",
	"them",
	"their",
]);

const extractKeywords = (query) => {
	return query
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
};

/** Run grep -rl with alternation pattern over docsRoot, rank files by keyword match count. */
const grepSearch = async (query, docsRoot, limit = 5) => {
	const keywords = extractKeywords(query);
	if (keywords.length === 0) return [];

	// Use -E with alternation to find all files matching any keyword in one call
	const pattern = keywords.join("|");
	let matchingFiles;
	try {
		const { stdout } = await exec(
			"grep",
			["-Erl", "-i", "--include=*.txt", pattern, docsRoot],
			{ maxBuffer: 1024 * 1024 },
		);
		matchingFiles = stdout.trim().split("\n").filter(Boolean);
	} catch (error) {
		// grep exits 1 when no matches found
		if (error.code === 1) return [];
		throw error;
	}

	if (matchingFiles.length <= limit) return matchingFiles;

	// Rank by counting how many keywords appear in each file
	const ranked = await Promise.all(
		matchingFiles.map(async (filePath) => {
			const content = await readFile(filePath, "utf8");
			const lower = content.toLowerCase();
			const hits = keywords.filter((kw) => lower.includes(kw)).length;
			return { filePath, hits };
		}),
	);

	return ranked
		.sort((a, b) => b.hits - a.hits)
		.slice(0, limit)
		.map((r) => r.filePath);
};

/** Extract a snippet from a file around the first keyword match. */
const extractSnippet = async (filePath, keywords, contextLines = 2) => {
	for (const keyword of keywords) {
		try {
			const { stdout } = await exec(
				"grep",
				["-i", "-m", "1", `-C${contextLines}`, keyword, filePath],
				{ maxBuffer: 1024 * 256 },
			);
			return stdout.trim();
		} catch {
			// try next keyword
		}
	}
	// Fallback: return first few lines of the file
	const content = await readFile(filePath, "utf8");
	return content.split("\n").slice(0, 5).join("\n").trim();
};

/** List all .txt files under a directory recursively. */
const listFiles = async (dir) => {
	const entries = [];
	const walk = async (d) => {
		const items = await readdir(d, { withFileTypes: true });
		for (const item of items) {
			const full = path.join(d, item.name);
			if (item.isDirectory()) await walk(full);
			else if (item.name.endsWith(".txt")) entries.push(full);
		}
	};
	await walk(dir);
	return entries;
};

/** Resolve metadata for a file path using the lookup table. */
const resolveMetadata = (filePath, docsRoot, lookup) => {
	return lookup[filePath] ?? lookup[path.relative(docsRoot, filePath)] ?? null;
};

const buildQueryResult = async (query, docsRoot, limit) => {
	const started = now();
	if (!query) {
		return {
			query,
			ok: false,
			durationMs: 0,
			resultCount: 0,
			matchingFiles: [],
			error: "no query",
		};
	}
	try {
		const matchingFiles = await grepSearch(query, docsRoot, limit);
		return {
			query,
			ok: true,
			durationMs: now() - started,
			resultCount: matchingFiles.length,
			matchingFiles,
			error: null,
		};
	} catch (error) {
		return {
			query,
			ok: false,
			durationMs: now() - started,
			resultCount: 0,
			matchingFiles: [],
			error: error instanceof Error ? error.message : String(error),
		};
	}
};

// --- Main ---

const searchResult = await buildQueryResult(request.query, request.docsRoot, 5);
const keywords = extractKeywords(request.query);

const answerSources = [];
for (const filePath of searchResult.matchingFiles.slice(0, 3)) {
	const metadata = resolveMetadata(filePath, request.docsRoot, request.lookup);
	const snippet = await extractSnippet(filePath, keywords);
	answerSources.push({
		summaryId: metadata?.summaryId ?? path.basename(filePath, ".txt"),
		type: metadata?.type ?? 0,
		title: metadata?.title ?? path.basename(filePath, ".txt"),
		snippet,
	});
}

// Test update: append marker to first doc and verify grep finds it
let updateMs = null;
if (request.documents.length > 0) {
	const started = now();
	const updated = request.documents[0];
	await writeFile(
		updated.path,
		`${updated.content}\n\n${request.updateMarker}\n`,
		"utf8",
	);
	const updateCheck = await grepSearch(
		request.updateMarker,
		request.docsRoot,
		1,
	);
	updateMs = now() - started;
	if (updateCheck.length === 0) {
		throw new Error("Update marker not found by grep after write");
	}
}

// Test delete: remove second doc and verify it's gone
let deleteMs = null;
if (request.documents.length > 1) {
	const started = now();
	const deletePath = request.documents[1].path;
	await rm(deletePath, { force: true });
	try {
		await stat(deletePath);
		throw new Error("Deleted file still exists");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	deleteMs = now() - started;
}

// List remaining files to verify state
const remainingFiles = await listFiles(request.docsRoot);

console.log(
	JSON.stringify({
		metrics: {
			searchMs: searchResult.durationMs,
			updateMs,
			deleteMs,
		},
		search: searchResult,
		answerSources,
		remainingFileCount: remainingFiles.length,
		remainingFiles: remainingFiles.map((f) =>
			path.relative(request.docsRoot, f),
		),
	}),
);
