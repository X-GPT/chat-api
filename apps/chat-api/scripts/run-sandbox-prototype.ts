import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Sandbox } from "e2b";
import { extractReferencesFromText } from "../src/features/chat/lib/extract-citations-from-markdown";

const PROTOTYPE_RUNNER_SOURCE_PATH = resolve(
	dirname(Bun.main),
	"prototype-runner.mjs",
);

const PROTOTYPE_WORKSPACE_ROOT = "/workspace/sandbox-prototype";
const PROTOTYPE_DOCS_ROOT = `${PROTOTYPE_WORKSPACE_ROOT}/docs`;
const PROTOTYPE_REQUEST_PATH = `${PROTOTYPE_WORKSPACE_ROOT}/request.json`;
const PROTOTYPE_RUNNER_PATH = `${PROTOTYPE_WORKSPACE_ROOT}/prototype-runner.mjs`;

type PrototypeSourceKind = "markdown" | "text" | "parser_output";

interface InputDocument {
	summaryId: string;
	type: number;
	content: string;
	title?: string | null;
	sourceKind?: PrototypeSourceKind | null;
}

interface PrototypeInput {
	userId: string;
	query: string;
	documents: InputDocument[];
	validatePersistence?: boolean;
}

const now = () => Date.now();

const sanitizePathSegment = (value: string) => {
	return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "unknown";
};

const buildAnswer = ({
	query,
	sources,
}: {
	query: string;
	sources: Array<{
		summaryId: string;
		type: number;
		title: string | null;
		snippet: string;
	}>;
}) => {
	if (sources.length === 0) {
		return `No relevant prototype results were found for "${query}".`;
	}

	const lines = sources.map((source, index) => {
		const n = index + 1;
		const title = source.title ?? `Document ${source.summaryId}`;
		const snippet = source.snippet.replace(/\s+/g, " ").trim();
		return `${n}. ${title}: ${snippet} [c${n}]`;
	});

	const refs = sources.map((source, index) => {
		const ref =
			source.type === 3
				? `notes/${source.type}/${source.summaryId}`
				: `detail/${source.type}/${source.summaryId}`;
		return `[c${index + 1}]: ${ref}`;
	});

	return [
		`Prototype retrieval summary for "${query}":`,
		...lines,
		"",
		"References:",
		...refs,
	].join("\n");
};

const loadInput = async () => {
	const inputPath = Bun.argv[2];
	if (!inputPath) {
		throw new Error("Usage: bun run prototype:sandbox <input.json>");
	}

	const raw = await readFile(inputPath, "utf8");
	return JSON.parse(raw) as PrototypeInput;
};

const materializeDocuments = (userId: string, documents: InputDocument[]) => {
	const docsRoot = `${PROTOTYPE_DOCS_ROOT}/${sanitizePathSegment(userId)}`;

	const files = documents.map((document) => {
		const relativePath = `${document.type}/${sanitizePathSegment(document.summaryId)}.txt`;
		const sourceKind = document.sourceKind ?? "text";
		const title = document.title?.trim() ?? "";

		return {
			summaryId: document.summaryId,
			type: document.type,
			title: document.title?.trim() || null,
			path: `${docsRoot}/${relativePath}`,
			relativePath,
			content: [
				"---",
				`summaryId: ${document.summaryId}`,
				`type: ${document.type}`,
				`sourceKind: ${sourceKind}`,
				`title: ${JSON.stringify(title)}`,
				"---",
				"",
				document.content.trim(),
				"",
			].join("\n"),
		};
	});

	return { docsRoot, files };
};

const runCommand = async (
	sandbox: Sandbox,
	command: string,
	options?: { cwd?: string; timeoutMs?: number },
) => {
	const result = await sandbox.commands.run(command, {
		cwd: options?.cwd,
		timeoutMs: options?.timeoutMs ?? 300_000,
	});

	if (result.exitCode !== 0) {
		throw new Error(result.stderr || result.stdout || "Sandbox command failed");
	}

	return result;
};

const main = async () => {
	if (!Bun.env.E2B_API_KEY) {
		throw new Error("E2B_API_KEY is required.");
	}

	const input = await loadInput();
	const runnerSource = await readFile(PROTOTYPE_RUNNER_SOURCE_PATH, "utf8");
	const startedAt = now();
	const template = Bun.env.E2B_TEMPLATE?.trim();
	if (!template) {
		throw new Error("E2B_TEMPLATE is required.");
	}
	const sandbox = await Sandbox.create(template, {
		metadata: { userId: input.userId, purpose: "phase1-sandbox-prototype" },
	});
	const sandboxBootstrapMs = now() - startedAt;

	try {
		const { docsRoot, files: documents } = materializeDocuments(
			input.userId,
			input.documents,
		);
		const lookup = Object.fromEntries(
			documents.flatMap((document) => {
				const value = {
					summaryId: document.summaryId,
					type: document.type,
					title: document.title,
				};

				return [
					[document.path, value],
					[document.relativePath, value],
				];
			}),
		);

		await sandbox.files.write([
			{ path: PROTOTYPE_RUNNER_PATH, data: runnerSource },
			...documents.map((document) => ({
				path: document.path,
				data: document.content,
			})),
			{
				path: PROTOTYPE_REQUEST_PATH,
				data: JSON.stringify(
					{
						query: input.query,
						docsRoot,
						documents,
						lookup,
						updateMarker: `phase1-update-marker-${Date.now()}`,
					},
					null,
					2,
				),
			},
		]);

		const runnerResult = await runCommand(
			sandbox,
			`node ${PROTOTYPE_RUNNER_PATH} ${PROTOTYPE_REQUEST_PATH}`,
			{ cwd: PROTOTYPE_WORKSPACE_ROOT, timeoutMs: 15_000 },
		);

		const runnerOutput = JSON.parse(runnerResult.stdout.trim()) as {
			metrics?: {
				searchMs?: number;
				updateMs?: number | null;
				deleteMs?: number | null;
			};
			search?: unknown;
			answerSources?: Array<{
				summaryId: string;
				type: number;
				title: string | null;
				snippet: string;
			}>;
			remainingFileCount?: number;
			remainingFiles?: string[];
		};

		let persistenceCheckMs: number | null = null;
		if (input.validatePersistence !== false) {
			const started = now();
			await sandbox.pause();
			const resumed = await Sandbox.connect(sandbox.sandboxId);
			const sampleDoc = documents[0];
			const [runnerExists, docExists] = await Promise.all([
				resumed.files.exists(PROTOTYPE_RUNNER_PATH),
				sampleDoc
					? resumed.files.exists(sampleDoc.path)
					: Promise.resolve(true),
			]);
			if (!runnerExists) {
				throw new Error("Runner script is missing after sandbox resume.");
			}
			if (!docExists) {
				throw new Error("Sample document is missing after sandbox resume.");
			}
			persistenceCheckMs = now() - started;
		}

		const answerText = buildAnswer({
			query: input.query,
			sources: runnerOutput.answerSources ?? [],
		});
		const citations = extractReferencesFromText(answerText);

		console.log(
			JSON.stringify(
				{
					sandboxId: sandbox.sandboxId,
					answerText,
					citationsParseable: citations.length > 0,
					citations,
					metrics: {
						sandboxBootstrapMs,
						searchMs: runnerOutput.metrics?.searchMs ?? null,
						updateMs: runnerOutput.metrics?.updateMs ?? null,
						deleteMs: runnerOutput.metrics?.deleteMs ?? null,
						persistenceCheckMs,
						totalMs: now() - startedAt,
					},
					search: runnerOutput.search ?? null,
					remainingFileCount: runnerOutput.remainingFileCount ?? null,
					remainingFiles: runnerOutput.remainingFiles ?? null,
				},
				null,
				2,
			),
		);
	} finally {
		sandbox.kill().catch(() => {});
	}
};

await main();
