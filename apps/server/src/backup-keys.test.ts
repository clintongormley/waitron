import { BACKUP_NODE_ID, OTHER_BACKUP_NODE_ID } from "./testing/backup-node.js";
import { describe, expect, it } from "vitest";
import { backupArchiveKey, dumpFileName, parseBackupArchiveKey } from "./backup-keys.js";

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

const NONCE = "0f8e2a1c-3b4d-4e5f-8a9b-1c2d3e4f5a6b";

describe("backupArchiveKey", () => {
  it("distinguishes boxes even when timestamp and nonce match", () => {
    const at = new Date("2026-08-29T17:55:01Z");
    expect(backupArchiveKey(at, { nodeId: BACKUP_NODE_ID, nonce: NONCE })).not.toBe(
      backupArchiveKey(at, { nodeId: OTHER_BACKUP_NODE_ID, nonce: NONCE }),
    );
  });

  it("produces a colon-free .backup.enc key sharing dumpFileName's stamp, then the box id and nonce", () => {
    const at = new Date("2026-08-29T17:55:01.123Z");
    const key = backupArchiveKey(at, { nodeId: BACKUP_NODE_ID, nonce: NONCE });
    expect(key).toBe(`waitron-20260829T175501Z-${BACKUP_NODE_ID}-${NONCE}.backup.enc`);
    expect(key).not.toContain(":");
    expect(key.startsWith(dumpFileName(at).replace(/\.dump$/, "-"))).toBe(true);
    // The prefix the prune and status scans list.
    expect(key.startsWith("waitron-")).toBe(true);
  });

  it("mints a different key for two archives at the same instant", () => {
    const at = new Date("2026-08-29T17:55:01Z");
    const keys = [
      backupArchiveKey(at, { nodeId: BACKUP_NODE_ID }),
      backupArchiveKey(at, { nodeId: BACKUP_NODE_ID }),
    ];
    expect(keys[0]).not.toBe(keys[1]);
    for (const key of keys) expect(parseBackupArchiveKey(key)).not.toBeNull();
  });
});

describe("parseBackupArchiveKey", () => {
  it("returns a minted key's stamp, to the second, and its box id and nonce", () => {
    const parsed = parseBackupArchiveKey(
      backupArchiveKey(new Date("2026-08-29T17:55:01.123Z"), {
        nodeId: BACKUP_NODE_ID,
        nonce: NONCE,
      }),
    );
    expect(parsed).toEqual({
      timestamp: new Date("2026-08-29T17:55:01.000Z"),
      nodeId: BACKUP_NODE_ID,
      nonce: NONCE,
    });
  });

  it("parses a default-minted key", () => {
    const at = new Date("2026-08-30T09:00:00Z");
    expect(
      parseBackupArchiveKey(backupArchiveKey(at, { nodeId: BACKUP_NODE_ID }))?.timestamp,
    ).toEqual(at);
  });

  it.each([
    ["the old nonce-only name", `waitron-20260829T175501Z-${NONCE}.backup.enc`],
    ["the old stamp-only name", "waitron-20260829T175501Z.backup.enc"],
    ["a nested name", `backups/waitron-20260829T175501Z-${BACKUP_NODE_ID}-${NONCE}.backup.enc`],
    [
      "an uppercase nonce",
      `waitron-20260829T175501Z-${BACKUP_NODE_ID}-${NONCE.toUpperCase()}.backup.enc`,
    ],
    ["a trailing suffix", `waitron-20260829T175501Z-${BACKUP_NODE_ID}-${NONCE}.backup.enc.tmp`],
    ["a leading prefix", `old-waitron-20260829T175501Z-${BACKUP_NODE_ID}-${NONCE}.backup.enc`],
    [
      "a valid name glued after another stamp",
      `waitron-20260829T175501Zwaitron-20260829T175501Z-${BACKUP_NODE_ID}-${NONCE}.backup.enc`,
    ],
    ["the staging dump name", "waitron-20260829T175501Z.dump"],
    [
      "a nonce that is not a UUID",
      `waitron-20260829T175501Z-${BACKUP_NODE_ID}-notauuid.backup.enc`,
    ],
    [
      "a nonce missing a group",
      `waitron-20260829T175501Z-${BACKUP_NODE_ID}-0f8e2a1c-3b4d-4e5f-1c2d3e4f5a6b.backup.enc`,
    ],
    ["a stamp with no Z", `waitron-20260829T175501-${BACKUP_NODE_ID}-${NONCE}.backup.enc`],
    [
      "a stamp with milliseconds",
      `waitron-20260829T175501123Z-${BACKUP_NODE_ID}-${NONCE}.backup.enc`,
    ],
    ["month 13", `waitron-20261329T175501Z-${BACKUP_NODE_ID}-${NONCE}.backup.enc`],
    ["30 February", `waitron-20260230T175501Z-${BACKUP_NODE_ID}-${NONCE}.backup.enc`],
    ["hour 24", `waitron-20260829T240000Z-${BACKUP_NODE_ID}-${NONCE}.backup.enc`],
    ["minute 60", `waitron-20260829T176001Z-${BACKUP_NODE_ID}-${NONCE}.backup.enc`],
    ["a trailing newline", `waitron-20260829T175501Z-${BACKUP_NODE_ID}-${NONCE}.backup.enc\n`],
    ["the empty name", ""],
  ])("rejects %s", (_label, key) => {
    expect(parseBackupArchiveKey(key)).toBeNull();
  });
});
