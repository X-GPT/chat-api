import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getCollectionDocsRoot } from "@/features/sandbox";
import { createNdjsonParser } from "./ndjson-parser";
import { buildSandboxAgentPrompt } from "./sandbox-agent.prompt";
import type { SandboxAgentOptions } from "./sandbox-agent.types";

const AGENT_RUNNER_PATH = "/workspace/sandbox-prototype/agent-runner.mjs";
const REQUEST_PATH = "/workspace/sandbox-prototype/request.json";

let cachedAgentRunnerSource: string | null = null;

function getAgentRunnerSource(): string {
	if (!cachedAgentRunnerSource) {
		const sourcePath = resolve(import.meta.dirname, "agent-runner.mjs");
		cachedAgentRunnerSource = readFileSync(sourcePath, "utf-8");
	}
	return cachedAgentRunnerSource;
}

/**
 * Resolve the agent's working directory based on scope.
 * Uses getCollectionDocsRoot to ensure collectionId is sanitized
 * consistently with the materialization paths.
 */
function resolveAgentCwd(
	docsRoot: string,
	scope: string,
	collectionId: string | null,
): string {
	if (scope === "collection" && collectionId) {
		return getCollectionDocsRoot(docsRoot, collectionId);
	}
	return docsRoot;
}

/**
 * Run the sandbox agent inside an E2B sandbox.
 *
 * Uploads the agent runner script and request JSON, then executes it
 * via the Claude Agent SDK. Streams NDJSON output back through callbacks.
 */
export async function runSandboxAgent(
	options: SandboxAgentOptions,
): Promise<void> {
	const {
		sandbox,
		docsRoot,
		anthropicApiKey,
		query,
		scope,
		collectionId,
		summaryId,
		sessionId,
		onTextDelta,
		onTextEnd,
		onSessionId,
		logger,
	} = options;

	const systemPrompt = buildSandboxAgentPrompt({
		scope,
		summaryId,
		collectionId,
		docsRoot,
		conversationContext: null,
	});

	const agentCwd = resolveAgentCwd(docsRoot, scope, collectionId);

	logger.info({
		msg: "Starting sandbox agent",
		scope,
		collectionId,
		summaryId,
		agentCwd,
	});

	const agentRunnerSource = getAgentRunnerSource();
	const requestPayload = JSON.stringify({
		query,
		systemPrompt,
		cwd: agentCwd,
		...(sessionId ? { sessionId } : {}),
	});

	await Promise.all([
		sandbox.files.write(AGENT_RUNNER_PATH, agentRunnerSource),
		sandbox.files.write(REQUEST_PATH, requestPayload),
	]);

	let agentError: string | null = null;
	let resultReceived = false;

	const parser = createNdjsonParser((event) => {
		switch (event.type) {
			case "text_delta":
				onTextDelta(event.text);
				break;
			case "result":
				resultReceived = true;
				break;
			case "error":
				agentError = event.message;
				break;
			case "session_id":
				onSessionId?.(event.sessionId);
				break;
		}
	});

	const result = await sandbox.commands.run(
		`node ${AGENT_RUNNER_PATH} ${REQUEST_PATH}`,
		{
			envs: { ANTHROPIC_API_KEY: anthropicApiKey },
			onStdout: (data) => parser.feed(data),
			onStderr: (data) => {
				logger.error({ msg: "Agent stderr", data });
			},
			timeoutMs: 120_000,
		},
	);

	parser.flush();

	if (result.exitCode !== 0) {
		const errorMsg =
			agentError ||
			result.stderr ||
			result.stdout ||
			"Agent process exited with non-zero code";
		logger.error({
			msg: "Sandbox agent failed",
			exitCode: result.exitCode,
			error: errorMsg,
		});
		throw new Error(`Sandbox agent failed: ${errorMsg}`);
	}

	if (agentError) {
		logger.error({ msg: "Sandbox agent reported error", error: agentError });
		throw new Error(`Sandbox agent error: ${agentError}`);
	}

	if (!resultReceived) {
		logger.error({ msg: "Agent exited without emitting a result event" });
	}

	await onTextEnd();

	logger.info({
		msg: "Sandbox agent completed",
		resultReceived,
	});
}
