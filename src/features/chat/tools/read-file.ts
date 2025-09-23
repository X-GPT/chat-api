import { tool } from "ai";
import { z } from "zod";

// the `tool` helper function ensures correct type inference:
export const readFileTool = tool({
	description: "Read a file",
	inputSchema: z.object({
		filePath: z.string().describe("The file path to read"),
	}),
	execute: async ({ filePath }) => ({
		filePath,
		content: "This is the content of the file",
		lastModified: new Date().toISOString(),
		size: 1000,
		extension: "txt",
		encoding: "utf-8",
		lines: 100,
		words: 1000,
		characters: 10000,
	}),
});
