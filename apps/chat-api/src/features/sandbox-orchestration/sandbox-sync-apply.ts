import { dirname } from "node:path";
import type { Sandbox } from "e2b";
import type { SyncLogger } from "@/features/sandbox";
import { buildTarGz } from "./sandbox-sync-archive";
import {
	writeStoredSyncState,
	writeSyncCompleteMarker,
} from "./sandbox-sync-state";
import type {
	IncrementalSyncPlan,
	InitialSyncPlan,
} from "./sandbox-sync-types";

export async function applyInitialSyncPlan(
	sandbox: Sandbox,
	plan: InitialSyncPlan,
): Promise<void> {
	if (plan.isEmpty) {
		await sandbox.commands.run(
			`rm -rf ${JSON.stringify(plan.docsRoot)} && mkdir -p ${JSON.stringify(plan.docsRoot)}`,
			{ timeoutMs: 10_000 },
		);
		await writeStoredSyncState(sandbox, plan.docsRoot, plan.nextState);
		await writeSyncCompleteMarker(sandbox, plan.docsRoot);
		return;
	}

	const tarBuffer = await buildTarGz(
		plan.primaryFiles,
		plan.collectionSymlinks,
	);
	await sandbox.files.write(
		"/tmp/docs.tar.gz",
		tarBuffer.buffer.slice(
			tarBuffer.byteOffset,
			tarBuffer.byteOffset + tarBuffer.byteLength,
		) as ArrayBuffer,
	);

	const quotedRoot = JSON.stringify(plan.docsRoot);
	const extractResult = await sandbox.commands.run(
		`rm -rf ${quotedRoot} && mkdir -p ${quotedRoot} && tar xzf /tmp/docs.tar.gz -C ${quotedRoot} && rm /tmp/docs.tar.gz`,
		{ timeoutMs: 120_000 },
	);
	if (extractResult.exitCode !== 0) {
		throw new Error(
			`Initial sync: tar extraction failed (exit ${extractResult.exitCode}): ${extractResult.stderr}`,
		);
	}
	await writeStoredSyncState(sandbox, plan.docsRoot, plan.nextState);
	await writeSyncCompleteMarker(sandbox, plan.docsRoot);
}

export async function applyIncrementalSyncPlan(
	sandbox: Sandbox,
	plan: IncrementalSyncPlan,
	logger: SyncLogger,
	userId: string,
): Promise<void> {
	// Build content file writes (without state file)
	const writeEntries: { path: string; data: string }[] = plan.writeFiles.map(
		(file) => ({ path: file.path, data: file.content }),
	);

	// Build combined shell command: rm + find -delete + mkdir/ln
	const cmdParts: string[] = [];

	if (plan.removeFiles.length > 0) {
		const paths = plan.removeFiles.map((p) => JSON.stringify(p)).join(" ");
		cmdParts.push(`rm -f -- ${paths}`);
	}

	if (plan.removeCollectionLinksByFilename.length > 0) {
		const nameArgs = plan.removeCollectionLinksByFilename
			.map((filename) => `-name ${JSON.stringify(filename)}`)
			.join(" -o ");
		cmdParts.push(
			`find ${JSON.stringify(`${plan.docsRoot}/collections`)} \\( ${nameArgs} \\) -delete 2>/dev/null || true`,
		);
	}

	for (const link of plan.createCollectionLinks) {
		const fullPath = `${plan.docsRoot}/${link.relativePath}`;
		cmdParts.push(
			`mkdir -p ${JSON.stringify(dirname(fullPath))} && ln -sf ${JSON.stringify(link.target)} ${JSON.stringify(fullPath)}`,
		);
	}

	// Execute content writes and shell commands in parallel
	const writePromise =
		writeEntries.length > 0
			? sandbox.files.write(writeEntries)
			: undefined;

	const cmdPromise =
		cmdParts.length > 0
			? sandbox.commands.run(cmdParts.join(" && "), { timeoutMs: 10_000 })
			: undefined;

	await Promise.all([writePromise, cmdPromise].filter(Boolean));

	if (cmdPromise) {
		const cmdResult = await cmdPromise;
		if (cmdResult.exitCode !== 0) {
			throw new Error(
				`Incremental sync: shell command failed (exit ${cmdResult.exitCode}): ${cmdResult.stderr}`,
			);
		}
	}

	// Persist state only after all filesystem mutations succeed
	await writeStoredSyncState(sandbox, plan.docsRoot, plan.nextState);
}
