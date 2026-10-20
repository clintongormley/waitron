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

  // Each case below declares TWO entries, the first padded so the truncated buffer still clears the
  // upfront `entryCount` bound and reaches the per-entry check the case is about.
  it("rejects a truncated name length field", () => {
    const good = packArchive([
      { name: "a".repeat(30), bytes: Buffer.from("y") },
      { name: "x", bytes: Buffer.from("y") },
    ]);
    // The first entry ends at header(9) + (4+30+8+1) = 52.
    expect(() => unpackArchive(good.subarray(0, 54))).toThrowError(
      expect.objectContaining({
        code: "backup.archive_invalid",
        params: { reason: "name_len_truncated" },
      }),
    );
  });

  it("rejects a truncated name", () => {
    const good = packArchive([
      { name: "a".repeat(30), bytes: Buffer.from("y") },
      { name: "hello", bytes: Buffer.from("y") },
    ]);
    expect(() => unpackArchive(good.subarray(0, 58))).toThrowError(
      expect.objectContaining({
        code: "backup.archive_invalid",
        params: { reason: "name_truncated" },
      }),
    );
  });

  it("rejects a truncated data length field", () => {
    const good = packArchive([
      { name: "a".repeat(30), bytes: Buffer.from("y") },
      { name: "x", bytes: Buffer.from("y") },
    ]);
    expect(() => unpackArchive(good.subarray(0, 60))).toThrowError(
      expect.objectContaining({
        code: "backup.archive_invalid",
        params: { reason: "data_len_truncated" },
      }),
    );
  });

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

  it("rejects a huge entry count with no entries behind it, without hanging", () => {
    const header = Buffer.concat([Buffer.from("WBA1"), Buffer.from([1]), Buffer.alloc(4)]);
    header.writeUInt32LE(0xffffffff, 5);
    expect(() => unpackArchive(header)).toThrowError(
      expect.objectContaining({
        code: "backup.archive_invalid",
        params: { reason: "entry_count_too_large" },
      }),
    );
  });

  it("roundtrips a non-ASCII entry name", () => {
    const entries = [{ name: "menú/café-☕.jpg", bytes: Buffer.from([1, 2, 3]) }];
    const out = unpackArchive(packArchive(entries));
    expect(out[0].name).toBe("menú/café-☕.jpg");
  });
});
