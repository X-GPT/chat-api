import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { create as createTar } from "tar";
import type { CollectionSymlink, MaterializedFile } from "@/features/sandbox";

export async function buildTarGz(
	files: MaterializedFile[],
	symlinks: CollectionSymlink[],
): Promise<Buffer> {
	const tmpDir = await mkdtemp(join(tmpdir(), "sandbox-sync-"));

	try {
		for (const file of files) {
			const filePath = join(tmpDir, file.relativePath);
			await mkdir(dirname(filePath), { recursive: true });
			await writeFile(filePath, file.content, "utf-8");
		}

		for (const link of symlinks) {
			const linkPath = join(tmpDir, link.relativePath);
			await mkdir(dirname(linkPath), { recursive: true });
			await symlink(link.target, linkPath);
		}

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
