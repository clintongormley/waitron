import { AppError } from "@waitron/shared";
import "./errors.js";

/** One named binary entry in a backup archive — the manifest, the DB dump, a media blob, or a
 * secrets file. `bytes` is raw, binary-safe content: no encoding is assumed or applied. */
export type ArchiveEntry = { name: string; bytes: Uint8Array };

const MAGIC = Buffer.from("WBA1"); // Waitron Backup Archive, format 1
const VERSION = 1;

/** Pack named entries into ONE deterministic binary container: `MAGIC(4) | version(1) |
 * entryCount(u32 LE) | [ nameLen(u32 LE) | name(utf8) | dataLen(u64 LE) | data ]*`, in the order
 * given. Entirely in-memory (`Buffer.concat`) — no streaming, a deliberate v1 deferral. This is the
 * container that gets encrypted ONCE as a whole by `encryptArtifact` (artifact-cipher.ts); it does
 * no encryption itself. */
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

/** Unpack a container produced by `packArchive`, back into its entries in order. Every declared
 * length (entry count, a name's length, an entry's data length) is bounds-checked against the
 * buffer BEFORE it is used to slice — a truncated container or a length that overruns the buffer
 * throws `backup.archive_invalid` rather than reading past the end or returning garbage. This
 * parses bytes that were sitting on disk/in transit and are attacker-influenced at restore time, so
 * every declared length is treated as untrusted input, never as a hint. */
export function unpackArchive(buf: Uint8Array): ArchiveEntry[] {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 0;
  // Every declared length reaching this helper is an unsigned integer read straight off the wire
  // (readUInt8/readUInt32LE), so it is never negative — the only thing to guard is running past
  // the end of the buffer.
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

    // dataLen is a u64 and may vastly exceed what Number can represent exactly, so the bound is
    // checked in BigInt arithmetic first; only once it is proven to fit within the actual
    // remaining buffer (itself a safe-integer length) is it narrowed to a Number for slicing.
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
