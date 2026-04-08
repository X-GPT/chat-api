import { Template } from "e2b";

const WORKSPACE_ROOT = "/workspace";

export const template = Template()
	.fromBunImage("1.3")
	.aptInstall(["curl", "git", "ripgrep", "lsof"])
	.setWorkdir(WORKSPACE_ROOT)
	.runCmd(`mkdir -p ${WORKSPACE_ROOT}/data`)
	.bunInstall("@anthropic-ai/claude-code", { g: true })
	.bunInstall("@anthropic-ai/claude-agent-sdk", { g: true })
	.bunInstall("hono", { g: true });
