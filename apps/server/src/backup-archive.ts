import { AppError } from "@waitron/shared";
import "./errors.js";

/** `bytes` is raw content: no encoding is assumed or applied. */
export type ArchiveEntry = { name: string; bytes: Uint8Array };

const MAGIC = Buffer.from("WBA1"); // Waitron Backup Archive, format 1
const VERSION = 1;
const HEADER_BYTES = MAGIC.length + 1 + 4;
// nameLen(4) + dataLen(8), with an empty name and empty data.
const MIN_ENTRY_BYTES = 4 + 8;

/** Packs entries, in the order given, as `MAGIC(4) | version(1) | entryCount(u32 LE) |
 * [ nameLen(u32 LE) | name(utf8) | dataLen(u64 LE) | data ]*`. It does no encryption itself; the
 * caller encrypts the whole container. */
export function packArchive(entries: ArchiveEntry[]): Buffer {
  const header = Buffer.alloc(MAGIC.length + 1 + 4);
  MAGIC.copy(header, 0);
  header.writeUInt8(VERSION, MAGIC.length);
  header.writeUInt32LE(entries.length, MAGIC.length + 1);
  const parts: Buffer[] = [header];
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.bytes.buffer, entry.bytes.byteOffset, entry.bytes.byteLength);
    const nameLen = Buffer.alloc(4);
    nameLen.writeUInt32LE(name.length, 0);
    const dataLen = Buffer.alloc(8);
    dataLen.writeBigUInt64LE(BigInt(data.length), 0);
    parts.push(nameLen, name, dataLen, data);
  }
  return Buffer.concat(parts);
}

/** The input is attacker-influenced at restore time, so every declared length is bounds-checked
 * against the buffer before it is used, and a violation throws `backup.archive_invalid`. */
export function unpackArchive(buf: Uint8Array): ArchiveEntry[] {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 0;
  const needRoomFor = (n: number, reason: string): void => {
    if (off + n > b.length) throw new AppError("backup.archive_invalid", { reason });
  };

  needRoomFor(MAGIC.length, "too_short");
  if (!b.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new AppError("backup.archive_invalid", { reason: "bad_magic" });
  }
  off = MAGIC.length;

  needRoomFor(1, "too_short");
  const version = b.readUInt8(off);
  off += 1;
  if (version !== VERSION) {
    throw new AppError("backup.archive_invalid", { reason: "bad_version" });
  }

  needRoomFor(4, "too_short");
  const entryCount = b.readUInt32LE(off);
  off += 4;

  const maxEntries = Math.floor((b.length - HEADER_BYTES) / MIN_ENTRY_BYTES);
  if (entryCount > maxEntries) {
    throw new AppError("backup.archive_invalid", { reason: "entry_count_too_large" });
  }

  const entries: ArchiveEntry[] = [];
  for (let i = 0; i < entryCount; i++) {
    needRoomFor(4, "name_len_truncated");
    const nameLen = b.readUInt32LE(off);
    off += 4;

    needRoomFor(nameLen, "name_truncated");
    const name = b.toString("utf8", off, off + nameLen);
    off += nameLen;

    needRoomFor(8, "data_len_truncated");
    const dataLen = b.readBigUInt64LE(off);
    off += 8;

    // A u64 can exceed what a Number holds exactly, so it is bounded as a BigInt before narrowing.
    const remaining = BigInt(b.length - off);
    if (dataLen > remaining)
      throw new AppError("backup.archive_invalid", { reason: "data_truncated" });
    const dataLenNum = Number(dataLen);
    const bytes = b.subarray(off, off + dataLenNum);
    off += dataLenNum;

    entries.push({ name, bytes });
  }
  return entries;
}
