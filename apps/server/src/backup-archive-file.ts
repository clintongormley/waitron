import { open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import type { ArchiveEntry } from "./backup-archive.js";
import { FILE_CHUNK_BYTES, readExactly, writeAll } from "./artifact-file-io.js";
import "./errors.js";

export type ArchiveInputEntry =
  { kind: "bytes"; entry: ArchiveEntry } | { kind: "file"; name: string; path: string };
export const ARCHIVE_MAX_ENTRIES = 4096;
export const ARCHIVE_MAX_NAME_BYTES = 4096;
export const ARCHIVE_MAX_METADATA_BYTES = 16 * 1024 * 1024;
function invalid(reason: string): never {
  throw new AppError("backup.archive_invalid", { reason });
}

export async function* packArchiveStream(
  entries: readonly ArchiveInputEntry[],
): AsyncIterable<Uint8Array> {
  if (entries.length > ARCHIVE_MAX_ENTRIES) invalid("entry_count_too_large");
  let metadata = 0;
  const names = entries.map((item) => {
    if (item.kind === "file" && item.name !== "db.dump") invalid("unexpected_file_entry");
    const name = Buffer.from(item.kind === "file" ? item.name : item.entry.name, "utf8");
    if (name.length > ARCHIVE_MAX_NAME_BYTES) invalid("name_too_large");
    if (item.kind === "bytes" && item.entry.name !== "db.dump") metadata += item.entry.bytes.length;
    if (metadata > ARCHIVE_MAX_METADATA_BYTES) invalid("metadata_too_large");
    return name;
  });
  const header = Buffer.from("574241310100000000", "hex");
  header.writeUInt32LE(entries.length, 5);
  yield header;
  for (const [index, item] of entries.entries()) {
    const name = names[index];
    const nameLength = Buffer.alloc(4);
    nameLength.writeUInt32LE(name.length);
    yield nameLength;
    yield name;
    const file = item.kind === "file" ? await open(item.path, "r") : undefined;
    try {
      const size = item.kind === "bytes" ? item.entry.bytes.length : (await file!.stat()).size;
      if (!Number.isSafeInteger(size)) invalid("data_truncated");
      const dataLength = Buffer.alloc(8);
      dataLength.writeBigUInt64LE(BigInt(size));
      yield dataLength;
      for (let offset = 0; offset < size; offset += FILE_CHUNK_BYTES) {
        const length = Math.min(FILE_CHUNK_BYTES, size - offset);
        if (file !== undefined) yield await readExactly(file, length, offset);
        else if (item.kind === "bytes") yield item.entry.bytes.subarray(offset, offset + length);
      }
    } finally {
      await file?.close();
    }
  }
}

export async function unpackArchiveFile(
  path: string,
  scratchDir: string,
): Promise<ArchiveInputEntry[]> {
  const file = await open(path, "r");
  const databasePath = join(scratchDir, "venue.db");
  let ownedDatabase = false;
  try {
    const size = (await file.stat()).size;
    if (!Number.isSafeInteger(size)) invalid("data_truncated");
    let offset = 0;
    async function take(length: number, reason: string): Promise<Buffer> {
      if (length > size - offset) invalid(reason);
      const bytes = await readExactly(file, length, offset, () => invalid(reason));
      offset += length;
      return bytes;
    }
    if (!(await take(4, "too_short")).equals(Buffer.from("WBA1"))) invalid("bad_magic");
    if ((await take(1, "too_short"))[0] !== 1) invalid("bad_version");
    const count = (await take(4, "too_short")).readUInt32LE();
    if (count > ARCHIVE_MAX_ENTRIES || count > Math.floor((size - 9) / 12))
      invalid("entry_count_too_large");
    let metadata = 0;
    const entries: ArchiveInputEntry[] = [];
    for (let index = 0; index < count; index++) {
      const nameLength = (await take(4, "name_len_truncated")).readUInt32LE();
      if (nameLength > ARCHIVE_MAX_NAME_BYTES) invalid("name_too_large");
      const name = (await take(nameLength, "name_truncated")).toString("utf8");
      const bigLength = (await take(8, "data_len_truncated")).readBigUInt64LE();
      if (bigLength > BigInt(size - offset)) invalid("data_truncated");
      const length = Number(bigLength);
      if (name === "db.dump") {
        if (ownedDatabase) {
          // Keep the duplicate name for validation; never overwrite the first extracted database.
          entries.push({ kind: "bytes", entry: { name, bytes: Buffer.alloc(0) } });
          offset += length;
          continue;
        }
        const output = await open(databasePath, "wx", 0o600);
        ownedDatabase = true;
        try {
          for (let left = length; left > 0; left -= FILE_CHUNK_BYTES) {
            await writeAll(output, await take(Math.min(left, FILE_CHUNK_BYTES), "data_truncated"));
          }
        } finally {
          await output.close();
        }
        entries.push({ kind: "file", name, path: databasePath });
      } else {
        metadata += length;
        if (metadata > ARCHIVE_MAX_METADATA_BYTES) invalid("metadata_too_large");
        entries.push({
          kind: "bytes",
          entry: { name, bytes: await take(length, "data_truncated") },
        });
      }
    }
    return entries;
  } catch (error) {
    if (ownedDatabase) await unlink(databasePath);
    throw error;
  } finally {
    await file.close();
  }
}
