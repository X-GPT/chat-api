import { Template } from "e2b";

const WORKSPACE_ROOT = "/workspace";

export const template = Template()
	.fromNodeImage("24")
	.aptInstall(["curl", "git", "ripgrep", "lsof", "zstd", "unzip"])
	.runCmd("curl -fsSL https://bun.sh/install | bash")
	.runCmd("ln -s /home/user/.bun/bin/bun /usr/local/bin/bun", { user: "root" })
	.setWorkdir(WORKSPACE_ROOT)
	.runCmd(`mkdir -p ${WORKSPACE_ROOT}/data`)
	.npmInstall("@anthropic-ai/claude-code", { g: true });
