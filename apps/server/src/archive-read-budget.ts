import { open } from "node:fs/promises";
import { AppError } from "@waitron/shared";
import {
  ARCHIVE_MAX_ENTRIES,
  ARCHIVE_MAX_NAME_BYTES,
  ARCHIVE_MAX_METADATA_BYTES,
} from "./backup-archive-file.js";
import { FILE_CHUNK_BYTES } from "./artifact-file-io.js";
import "./errors.js";

export class ArchiveReadBudget {
  private entries = 0;
  private bytes = 0;
  get remainingBytes(): number {
    return ARCHIVE_MAX_METADATA_BYTES - this.bytes;
  }
  addEntry(name: string, size: number): void {
    if (this.entries >= ARCHIVE_MAX_ENTRIES) this.invalid("entry_count_too_large");
    if (Buffer.byteLength(name, "utf8") > ARCHIVE_MAX_NAME_BYTES) this.invalid("name_too_large");
    this.addBytes(size);
    this.entries++;
  }
  addBytes(size: number): void {
    if (size > this.remainingBytes) this.invalid("metadata_too_large");
    this.bytes += size;
  }
  private invalid(reason: string): never {
    throw new AppError("backup.archive_invalid", { reason });
  }
}

export async function readArchiveStateFile(
  path: string,
  budget: ArchiveReadBudget,
  name = path,
): Promise<Buffer> {
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size;
    budget.addEntry(name, size);
    const chunks: Buffer[] = [];
    let position = 0;
    for (;;) {
      // One extra byte detects growth beyond the shared budget without allocating that growth.
      const limit = Math.min(
        FILE_CHUNK_BYTES,
        Math.max(0, size - position) + budget.remainingBytes + 1,
      );
      const chunk = Buffer.alloc(limit);
      const { bytesRead } = await file.read(chunk, 0, limit, position);
      if (bytesRead === 0) break;
      budget.addBytes(Math.max(0, position + bytesRead - size) - Math.max(0, position - size));
      chunks.push(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
    return Buffer.concat(chunks, position);
  } finally {
    await file.close();
  }
}
