import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import pLimit from "p-limit";
import { create as createTar } from "tar";
import type { CollectionSymlink, MaterializedFile } from "@/features/sandbox";

const CONCURRENCY = 50;

export async function buildTarGz(
	files: MaterializedFile[],
	symlinks: CollectionSymlink[],
): Promise<Buffer> {
	const tmpDir = await mkdtemp(join(tmpdir(), "sandbox-sync-"));
	const limit = pLimit(CONCURRENCY);

	try {
		// Pre-create all unique directories, then write files in parallel
		const fileDirs = new Set(files.map((f) => dirname(join(tmpDir, f.relativePath))));
		const linkDirs = new Set(symlinks.map((l) => dirname(join(tmpDir, l.relativePath))));
		const allDirs = new Set([...fileDirs, ...linkDirs]);
		await Promise.all([...allDirs].map((d) => mkdir(d, { recursive: true })));

		await Promise.all(
			files.map((file) =>
				limit(() => writeFile(join(tmpDir, file.relativePath), file.content, "utf-8")),
			),
		);

		await Promise.all(
			symlinks.map((link) =>
				limit(() => symlink(link.target, join(tmpDir, link.relativePath))),
			),
		);

		const chunks: Uint8Array[] = [];
		const stream = createTar({ gzip: true, cwd: tmpDir }, ["."]);
		for await (const chunk of stream) {
			chunks.push(
				chunk instanceof Buffer
					? chunk
					: new Uint8Array(chunk as ArrayLike<number>),
			);
		}

		return Buffer.concat(chunks);
	} finally {
		await rm(tmpDir, { recursive: true, force: true });
	}
}
