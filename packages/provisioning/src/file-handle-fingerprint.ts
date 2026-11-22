import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";

export async function fingerprintFileHandle(handle: FileHandle, end?: number) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of handle.createReadStream({
    autoClose: false,
    end,
  }) as AsyncIterable<Buffer>) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { size, sha256: hash.digest("hex") };
}
