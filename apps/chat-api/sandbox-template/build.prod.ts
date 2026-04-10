import { defaultBuildLogger, Template } from "e2b";
import { template } from "./template";

async function main() {
	await Template.build(template, "sandbox-template", {
		onBuildLogs: defaultBuildLogger(),
	});
}

main().catch(console.error);
