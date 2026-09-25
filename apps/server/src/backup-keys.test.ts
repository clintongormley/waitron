import { describe, expect, it } from "vitest";
import { backupArchiveKey, backupArchiveTimestamp, dumpFileName } from "./backup-keys.js";

describe("dumpFileName", () => {
  it("produces a sortable, colon-free, .dump-suffixed name", () => {
    const name = dumpFileName(new Date("2026-08-29T17:55:01.123Z"));
    expect(name).toBe("waitron-20260829T175501Z.dump");
    expect(name).not.toContain(":");
    expect(name.endsWith(".dump")).toBe(true);
  });

  it("names sort lexically in chronological order", () => {
    const earlier = dumpFileName(new Date("2026-08-29T17:55:01Z"));
    const later = dumpFileName(new Date("2026-08-29T17:55:02Z"));
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });
});

describe("backupArchiveKey", () => {
  it("produces a colon-free .backup.enc key sharing dumpFileName's stamp", () => {
    const at = new Date("2026-08-29T17:55:01.123Z");
    const key = backupArchiveKey(at);
    expect(key).toBe("waitron-20260829T175501Z.backup.enc");
    expect(key).not.toContain(":");
    expect(key).toBe(dumpFileName(at).replace(/\.dump$/, ".backup.enc"));
    // The prefix the prune and status scans list.
    expect(key.startsWith("waitron-")).toBe(true);
  });
});

describe("backupArchiveTimestamp", () => {
  it("round-trips backupArchiveKey to second precision", () => {
    const d = new Date("2026-08-29T17:55:01.123Z");
    const truncated = new Date("2026-08-29T17:55:01.000Z");
    expect(backupArchiveTimestamp(backupArchiveKey(d))).toEqual(truncated);
  });

  it("parses the stamp out of a full waitron-*.backup.enc key", () => {
    expect(backupArchiveTimestamp("waitron-20260829T175501Z.backup.enc")).toEqual(
      new Date("2026-08-29T17:55:01.000Z"),
    );
  });

  it("recovers the ordering of two keys as an instant comparison", () => {
    const older = backupArchiveTimestamp(backupArchiveKey(new Date("2026-08-29T17:55:01Z")));
    const newer = backupArchiveTimestamp(backupArchiveKey(new Date("2026-08-30T09:00:00Z")));
    expect(newer.getTime()).toBeGreaterThan(older.getTime());
  });

  it("throws on a key carrying no parseable stamp", () => {
    expect(() => backupArchiveTimestamp("waitron-notastamp.backup.enc")).toThrow(
      /no parseable timestamp/,
    );
  });
});
