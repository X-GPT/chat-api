import { mock } from "bun:test";

export interface MockSandbox {
	sandboxId: string;
	files: {
		read: ReturnType<typeof mock>;
		write: ReturnType<typeof mock>;
	};
	commands: {
		run: ReturnType<typeof mock>;
	};
	filesWritten: Map<string, string | ArrayBuffer>;
	filesContent: Map<string, string>;
	commandsRun: string[];
}

export function createMockSandbox(sandboxId = "sbx-123"): MockSandbox {
	const filesWritten = new Map<string, string | ArrayBuffer>();
	const filesContent = new Map<string, string>();
	const commandsRun: string[] = [];

	return {
		sandboxId,
		filesWritten,
		filesContent,
		commandsRun,
		files: {
			read: mock((path: string) => {
				if (filesContent.has(path)) {
					return Promise.resolve(filesContent.get(path));
				}
				return Promise.reject(new Error("File not found"));
			}),
			write: mock((path: string, content: string | ArrayBuffer) => {
				filesWritten.set(path, content);
				if (typeof content === "string") {
					filesContent.set(path, content);
				}
				return Promise.resolve();
			}),
		},
		commands: {
			run: mock((cmd: string) => {
				commandsRun.push(cmd);
				return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
			}),
		},
	};
}
