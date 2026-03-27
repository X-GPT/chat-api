import { Template } from "e2b";

const WORKSPACE_ROOT = "/workspace/sandbox-prototype";

export const template = Template()
	.fromNodeImage("lts")
	.setWorkdir(WORKSPACE_ROOT)
	.runCmd(`mkdir -p ${WORKSPACE_ROOT}/docs`);
