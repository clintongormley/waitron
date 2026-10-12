import type { FileHandle } from "node:fs/promises";
export const FILE_CHUNK_BYTES = 64 * 1024;

export async function readExactly(
  file: FileHandle,
  length: number,
  position: number,
  truncated: () => never = () => {
    throw new Error("Unexpected end of file");
  },
): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await file.read(
      bytes,
      offset,
      Math.min(FILE_CHUNK_BYTES, length - offset),
      position + offset,
    );
    if (bytesRead === 0) truncated();
    offset += bytesRead;
  }
  return bytes;
}

export async function writeAll(
  file: FileHandle,
  bytes: Uint8Array,
  position: number | null = null,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await file.write(
      bytes,
      offset,
      Math.min(FILE_CHUNK_BYTES, bytes.length - offset),
      position === null ? null : position + offset,
    );
    if (bytesWritten === 0) throw new Error("File write made no progress");
    offset += bytesWritten;
  }
}
