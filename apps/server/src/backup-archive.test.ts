import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { packArchive, unpackArchive } from "./backup-archive.js";

describe("backup archive", () => {
  it("roundtrips named binary entries in order", () => {
    const entries = [
      { name: "manifest.json", bytes: Buffer.from('{"v":1}') },
      { name: "db.dump", bytes: randomBytes(5000) },
      { name: "media/abc.jpg", bytes: randomBytes(1234) },
    ];
    const out = unpackArchive(packArchive(entries));
    expect(out.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    expect(Buffer.from(out[1].bytes).equals(Buffer.from(entries[1].bytes))).toBe(true);
  });
  it("handles an empty entry and an empty archive", () => {
    expect(unpackArchive(packArchive([]))).toEqual([]);
    const out = unpackArchive(packArchive([{ name: "empty", bytes: new Uint8Array(0) }]));
    expect(out[0].bytes).toHaveLength(0);
  });
  it("rejects a truncated container", () => {
    const good = packArchive([{ name: "x", bytes: Buffer.from("y") }]);
    expect(() => unpackArchive(good.subarray(0, good.length - 1))).toThrowError(
      expect.objectContaining({ code: "backup.archive_invalid" }),
    );
  });
  it("rejects a bad magic", () => {
    expect(() => unpackArchive(Buffer.alloc(9))).toThrowError(
      expect.objectContaining({ code: "backup.archive_invalid" }),
    );
  });

  // A buffer shorter than the 4-byte magic itself is a distinct malformed shape from "bad magic"
  // (which needs at least 4 bytes to compare against) — it must hit the length guard before the
  // magic is ever read, not throw a Buffer out-of-bounds error or return garbage.
  it("rejects a buffer shorter than the magic", () => {
    expect(() => unpackArchive(Buffer.alloc(2))).toThrowError(
      expect.objectContaining({ code: "backup.archive_invalid", params: { reason: "too_short" } }),
    );
  });

  it("rejects a valid magic with an unknown version", () => {
    const good = packArchive([{ name: "x", bytes: Buffer.from("y") }]);
    good[4] = 99; // version byte, right after the 4-byte magic
    expect(() => unpackArchive(good)).toThrowError(
      expect.objectContaining({
        code: "backup.archive_invalid",
        params: { reason: "bad_version" },
      }),
    );
  });

  // Each declared length (name length, name bytes, data length) gets its own bounds check, so each
  // needs its own case to prove that check — not just the aggregate data-length case above — fires
  // rather than reading past the buffer.
  it("rejects a truncated name length field", () => {
    const good = packArchive([{ name: "x", bytes: Buffer.from("y") }]);
    // Header is magic(4)+version(1)+count(4) = 9 bytes; cut right after it, before the 4-byte
    // nameLen field can be fully read.
    expect(() => unpackArchive(good.subarray(0, 11))).toThrowError(
      expect.objectContaining({
        code: "backup.archive_invalid",
        params: { reason: "name_len_truncated" },
      }),
    );
  });

  it("rejects a truncated name", () => {
    const good = packArchive([{ name: "hello", bytes: Buffer.from("y") }]);
    // Header(9) + nameLen(4) = 13; the declared name is 5 bytes but only 2 are supplied.
    expect(() => unpackArchive(good.subarray(0, 15))).toThrowError(
      expect.objectContaining({
        code: "backup.archive_invalid",
        params: { reason: "name_truncated" },
      }),
    );
  });

  it("rejects a truncated data length field", () => {
    const good = packArchive([{ name: "x", bytes: Buffer.from("y") }]);
    // Header(9) + nameLen(4) + name(1) = 14; cut before the 8-byte dataLen can be fully read.
    expect(() => unpackArchive(good.subarray(0, 17))).toThrowError(
      expect.objectContaining({
        code: "backup.archive_invalid",
        params: { reason: "data_len_truncated" },
      }),
    );
  });

  // An oversized declared data length (not merely "one byte short") must be caught by the same
  // guard as the off-by-one truncation case, so a corrupted (not just clipped) length field is
  // refused too.
  it("rejects a data length that wildly overruns the buffer", () => {
    const good = packArchive([{ name: "x", bytes: Buffer.from("y") }]);
    // dataLen is the 8-byte LE field right before the 1-byte payload.
    good.writeBigUInt64LE(0xffffffffffn, good.length - 1 - 8);
    expect(() => unpackArchive(good)).toThrowError(
      expect.objectContaining({
        code: "backup.archive_invalid",
        params: { reason: "data_truncated" },
      }),
    );
  });

  // A huge declared entryCount with no data behind it must fail fast on the FIRST entry's bounds
  // check, not attempt to loop or allocate anything sized by the untrusted count — proves the
  // per-entry guard, not the count itself, is what keeps this cheap against a hostile container.
  it("rejects a huge entry count with no entries behind it, without hanging", () => {
    const header = Buffer.concat([Buffer.from("WBA1"), Buffer.from([1]), Buffer.alloc(4)]);
    header.writeUInt32LE(0xffffffff, 5);
    expect(() => unpackArchive(header)).toThrowError(
      expect.objectContaining({
        code: "backup.archive_invalid",
        params: { reason: "name_len_truncated" },
      }),
    );
  });

  it("roundtrips a non-ASCII entry name", () => {
    const entries = [{ name: "menú/café-☕.jpg", bytes: Buffer.from([1, 2, 3]) }];
    const out = unpackArchive(packArchive(entries));
    expect(out[0].name).toBe("menú/café-☕.jpg");
  });
});
