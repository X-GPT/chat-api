import { defaultBuildLogger, Template } from "e2b";
import { bundleCli } from "./build-cli";
import { template } from "./template";

async function main() {
	await bundleCli();
	await Template.build(template, "sandbox-template-dev", {
		onBuildLogs: defaultBuildLogger(),
	});
}

main().catch(console.error);
