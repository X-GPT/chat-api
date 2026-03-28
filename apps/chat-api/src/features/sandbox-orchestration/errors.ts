export class SandboxCreationError extends Error {
	override name = "SandboxCreationError" as const;
}

export class SandboxSyncError extends Error {
	override name = "SandboxSyncError" as const;
}

export class SandboxAgentError extends Error {
	override name = "SandboxAgentError" as const;
}
