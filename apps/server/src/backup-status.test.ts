import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readBackupStatus } from "./backup-status.js";

const NOW = new Date("2026-08-29T12:00:00.000Z");
const HOUR_MS = 3_600_000;

describe("readBackupStatus", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "backup-status-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reports no-backup-yet as stale with null fields when the dir holds no dumps", async () => {
    // A non-dump file must not count as a backup.
    writeFileSync(join(dir, "notes.txt"), "not a dump");
    expect(await readBackupStatus(dir, HOUR_MS, NOW)).toEqual({
      configured: true,
      lastBackupAt: null,
      ageSeconds: null,
      stale: true,
    });
  });

  it("tolerates a missing dir as no-backup-yet (stale, null fields)", async () => {
    const missing = join(dir, "does-not-exist");
    expect(await readBackupStatus(missing, HOUR_MS, NOW)).toEqual({
      configured: true,
      lastBackupAt: null,
      ageSeconds: null,
      stale: true,
    });
  });

  it("picks the newest dump by mtime and reports its age when fresh", async () => {
    // Older mtime (2h ago) and newer mtime (10min ago); the newer one must win.
    const older = join(dir, "waitron-20260829T090000Z.dump");
    const newer = join(dir, "waitron-20260829T100000Z.dump");
    writeFileSync(older, "old");
    writeFileSync(newer, "new");
    const olderMtime = new Date(NOW.getTime() - 2 * HOUR_MS);
    const newerMtime = new Date(NOW.getTime() - 10 * 60_000);
    await utimes(older, olderMtime, olderMtime);
    await utimes(newer, newerMtime, newerMtime);

    expect(await readBackupStatus(newer.replace(/\/[^/]+$/, ""), 30 * 60_000, NOW)).toEqual({
      configured: true,
      lastBackupAt: newerMtime.toISOString(),
      ageSeconds: 600,
      stale: false,
    });
  });

  it("marks the newest dump stale once its age passes the threshold", async () => {
    const dump = join(dir, "waitron-20260829T100000Z.dump");
    writeFileSync(dump, "x");
    const mtime = new Date(NOW.getTime() - 90 * 60_000); // 90 min old
    await utimes(dump, mtime, mtime);

    // Threshold 1h: 90-min-old backup is stale.
    expect(await readBackupStatus(dir, HOUR_MS, NOW)).toEqual({
      configured: true,
      lastBackupAt: mtime.toISOString(),
      ageSeconds: 5400,
      stale: true,
    });

    // Threshold 2h: the same backup is fresh — proving the comparison is against the threshold.
    expect(await readBackupStatus(dir, 2 * HOUR_MS, NOW)).toEqual({
      configured: true,
      lastBackupAt: mtime.toISOString(),
      ageSeconds: 5400,
      stale: false,
    });
  });

  it("ignores subdirectories that match the dump name pattern", async () => {
    // A directory named like a dump must not be mistaken for a backup file.
    await mkdir(join(dir, "waitron-20260829T100000Z.dump"));
    expect(await readBackupStatus(dir, HOUR_MS, NOW)).toEqual({
      configured: true,
      lastBackupAt: null,
      ageSeconds: null,
      stale: true,
    });
  });
});
