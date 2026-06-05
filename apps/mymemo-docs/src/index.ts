#!/usr/bin/env bun
/**
 * mymemo-docs — document access for the sandboxed agent.
 *
 * The agent calls this via its Bash tool. It holds NO credential: it reads the
 * per-turn document-gateway URL + bearer token from the environment (set on the
 * agent process by the daemon) and forwards search/fetch to the gateway, which
 * verifies the token and enforces the turn's scope server-side.
 *
 * Built with citty so `--help` is generated from the command definitions below.
 * `build.ts` bundles this (citty inlined) into a single self-contained
 * `dist/mymemo-docs` file; chat-api's E2B template stages and `.copy()`s that
 * artifact onto the sandbox PATH.
 */
import { defineCommand, runMain } from "citty";

const BASE = process.env.MYMEMO_DOC_GATEWAY_URL;
const TOKEN = process.env.MYMEMO_DOC_TOKEN;

interface SearchHit {
	passageId: string;
	documentId: string;
	title?: string;
	snippet?: string;
}

interface FetchedDocument {
	title?: string;
	content?: string;
}

async function call<T>(path: string, body: unknown): Promise<T> {
	if (!BASE || !TOKEN) {
		throw new Error("MYMEMO_DOC_GATEWAY_URL / MYMEMO_DOC_TOKEN not set");
	}
	const res = await fetch(`${BASE}${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${TOKEN}`,
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
	return res.json() as Promise<T>;
}

const search = defineCommand({
	meta: {
		name: "search",
		description:
			"Find passages matching a query. Prints one JSON object per line: {passageId, documentId, title, snippet}. Cite the passageId; fetch the documentId for full content. (Search is scoped to the turn automatically.)",
	},
	args: {
		query: {
			type: "positional",
			required: true,
			description: "Search text (wrap a multi-word query in quotes).",
		},
	},
	async run({ args }) {
		// args._ holds every positional, so joining reproduces the query whether
		// quoted or unquoted. Scope (collection/document) is enforced by the
		// gateway from the signed token — the agent cannot widen it here.
		const query = args._.join(" ");
		const result = await call<{ documents?: SearchHit[] }>(
			"/v1/documents/search",
			{ query },
		);
		// Tolerate a malformed upstream payload (null / non-array) instead of
		// crashing — treat anything that isn't an array as zero results.
		const documents = Array.isArray(result.documents) ? result.documents : [];
		// NDJSON: one JSON object per line. JSON.stringify escapes any tabs/
		// newlines in title/snippet, so a record can never break the line or
		// field structure. No matches -> no stdout (note goes to stderr).
		if (documents.length === 0) {
			console.error("(no documents found)");
			return;
		}
		for (const d of documents) {
			console.log(
				JSON.stringify({
					passageId: d.passageId ?? "",
					documentId: d.documentId ?? "",
					title: d.title ?? "",
					snippet: d.snippet ?? "",
				}),
			);
		}
	},
});

const fetchCommand = defineCommand({
	meta: {
		name: "fetch",
		description:
			"Print a document's full content (preceded by a 'title:' line) by its documentId from a search result.",
	},
	args: {
		documentId: {
			type: "positional",
			required: true,
			description: "A documentId from a search result.",
		},
	},
	async run({ args }) {
		const doc = await call<FetchedDocument>("/v1/documents/fetch", {
			documentId: args.documentId,
		});
		console.log(`title: ${doc.title ?? ""}`);
		console.log("---");
		console.log(doc.content ?? "");
	},
});

const main = defineCommand({
	meta: {
		name: "mymemo-docs",
		description: "Search and fetch your MyMemo documents.",
	},
	subCommands: { search, fetch: fetchCommand },
});

runMain(main);
