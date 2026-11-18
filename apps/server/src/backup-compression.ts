import { createReadStream } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import { AppError } from "@waitron/shared";
import { writeAll } from "./artifact-file-io.js";
import { freeBytes, type Statfs } from "./free-bytes.js";
import { START_FREE_SPACE_FLOOR } from "./start-space.js";
import "./errors.js";

export async function* compressArchive(
  source: AsyncIterable<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<Uint8Array> {
  yield* Readable.from(source).compose(createGzip({ level: 6 }), { signal });
}

export async function decodeArchiveFile(
  inputPath: string,
  outputPath: string,
  options: { signal?: AbortSignal; statfs?: Statfs; maxBytes?: number } = {},
): Promise<string> {
  options.signal?.throwIfAborted();
  const input = await open(inputPath, "r");
  const maxBytes = options.maxBytes ?? Infinity;
  let gzip: boolean;
  try {
    const magic = Buffer.alloc(2);
    const { bytesRead } = await input.read(magic, 0, 2, 0);
    gzip = bytesRead === 2 && magic[0] === 0x1f && magic[1] === 0x8b;
    if (!gzip && Number.isFinite(maxBytes) && (await input.stat()).size > maxBytes)
      throw new AppError("restore.archive_resource_limit", {});
  } finally {
    await input.close();
  }
  if (!gzip) return inputPath;
  const free = await freeBytes(dirname(inputPath), options.statfs);
  // Both the decoded archive and its extracted database occupy scratch during unpacking.
  const budget =
    free === null ? 0 : Math.min(maxBytes, Math.floor((free - START_FREE_SPACE_FLOOR) / 2));
  if (budget <= 0) throw new AppError("restore.archive_resource_limit", {});
  const output = await open(outputPath, "wx", 0o600);
  try {
    let total = 0;
    await pipeline(
      createReadStream(inputPath),
      createGunzip({ rejectGarbageAfterEnd: true }),
      async (chunks) => {
        for await (const chunk of chunks) {
          total += chunk.length;
          if (total > budget) throw new AppError("restore.archive_resource_limit", {});
          await writeAll(output, chunk);
        }
      },
      { signal: options.signal },
    );
  } catch (error) {
    await unlink(outputPath);
    if (
      error instanceof Error &&
      "code" in error &&
      ["Z_DATA_ERROR", "Z_BUF_ERROR", "ERR_TRAILING_JUNK_AFTER_STREAM_END"].includes(
        String(error.code),
      )
    )
      throw new AppError("backup.archive_invalid", { reason: "compression_invalid" });
    throw error;
  } finally {
    await output.close();
  }
  await unlink(inputPath);
  return outputPath;
}
