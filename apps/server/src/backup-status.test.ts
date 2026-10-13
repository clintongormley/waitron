import { mkdtempSync, writeFileSync } from "node:fs";
import { rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readBackupStatus } from "./backup-status.js";
import { buildBackupBackend } from "./backup-backends.js";
import { backupArchiveKey } from "./backup-keys.js";
import { AppError } from "@waitron/shared";
import type { StorageBackend, StoredObject } from "./storage-backend.js";

const backend = (id: string, newestMtimeMs: number | null): StorageBackend => ({
  id,
  put: async () => {},
  putFile: async () => {},
  getFile: async () => {},
  get: async () => Buffer.alloc(0),
  delete: async () => {},
  deleteMany: async () => {},
  close: () => {},
  list: async (): Promise<StoredObject[]> =>
    newestMtimeMs === null
      ? []
      : [{ key: backupArchiveKey(new Date(newestMtimeMs)), size: 1, mtimeMs: newestMtimeMs }],
});

const listing = (id: string, list: StorageBackend["list"]): StorageBackend => ({
  ...backend(id, null),
  list,
});

const NOW = new Date("2026-09-05T12:00:00Z");

describe("readBackupStatus", () => {
  it("reports fresh per destination", async () => {
    const s = await readBackupStatus([backend("a", NOW.getTime() - 1000)], 60_000, NOW);
    expect(s).toMatchObject({
      configured: true,
      destinations: [{ id: "a", ageSeconds: 1, stale: false }],
    });
  });

  it("marks a destination stale past staleAfterMs", async () => {
    const s = await readBackupStatus([backend("a", NOW.getTime() - 120_000)], 60_000, NOW);
    expect(s).toMatchObject({ configured: true, destinations: [{ id: "a", stale: true }] });
  });

  it("a destination with no backups yet is stale with null age", async () => {
    const s = await readBackupStatus([backend("a", null)], 60_000, NOW);
    expect(s).toMatchObject({
      configured: true,
      destinations: [{ id: "a", lastBackupAt: null, ageSeconds: null, stale: true }],
    });
  });

  it("reports one entry per destination, each read independently", async () => {
    const s = await readBackupStatus(
      [backend("a", NOW.getTime() - 1000), backend("b", null)],
      60_000,
      NOW,
    );
    expect(s).toEqual({
      configured: true,
      destinations: [
        {
          id: "a",
          lastBackupAt: new Date(NOW.getTime() - 1000).toISOString(),
          ageSeconds: 1,
          stale: false,
          readErrorCode: null,
        },
        { id: "b", lastBackupAt: null, ageSeconds: null, stale: true, readErrorCode: null },
      ],
    });
  });

  it("a destination whose listing fails reads stale with its code, beside a healthy sibling", async () => {
    const s = await readBackupStatus(
      [
        listing("bucket", async () => {
          throw new AppError("backup.destination_object_too_large", { maxBytes: 1 });
        }),
        backend("local", NOW.getTime() - 1000),
      ],
      60_000,
      NOW,
    );
    expect(s).toEqual({
      configured: true,
      destinations: [
        {
          id: "bucket",
          lastBackupAt: null,
          ageSeconds: null,
          stale: true,
          readErrorCode: "backup.destination_object_too_large",
        },
        {
          id: "local",
          lastBackupAt: new Date(NOW.getTime() - 1000).toISOString(),
          ageSeconds: 1,
          stale: false,
          readErrorCode: null,
        },
      ],
    });
  });

  it("an uncoded listing failure reads as unknown, never its message", async () => {
    const s = await readBackupStatus(
      [
        listing("local", async () => {
          throw new Error("EACCES: /secret/path");
        }),
      ],
      60_000,
      NOW,
    );
    expect(s).toEqual({
      configured: true,
      destinations: [
        {
          id: "local",
          lastBackupAt: null,
          ageSeconds: null,
          stale: true,
          readErrorCode: "unknown",
        },
      ],
    });
  });

  it("a listing that never answers is cut off at the read limit, and its sibling still reports", async () => {
    let seen: AbortSignal | undefined;
    const stalled = listing(
      "bucket",
      (_prefix, call) =>
        new Promise((_resolve, reject) => {
          seen = call.signal;
          call.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );
    const started = Date.now();
    const s = await readBackupStatus(
      [stalled, backend("local", NOW.getTime() - 1000)],
      60_000,
      NOW,
      50,
    );
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(seen?.aborted).toBe(true);
    expect(s).toMatchObject({
      configured: true,
      destinations: [
        { id: "bucket", stale: true, readErrorCode: "backup.destination_timed_out" },
        { id: "local", stale: false, readErrorCode: null },
      ],
    });
  });

  it("gives each status read a thirty-second limit by default", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const stalled = listing(
        "bucket",
        (_prefix, call) =>
          new Promise((_resolve, reject) => {
            call.signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(new Error("aborted"));
              },
              { once: true },
            );
          }),
      );
      const reading = readBackupStatus([stalled], 60_000, NOW);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(aborted).toBe(true);
      await expect(reading).resolves.toMatchObject({
        destinations: [{ readErrorCode: "backup.destination_timed_out" }],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts only names the archive parser reads, so a newer foreign or old-format name is ignored", async () => {
    const archiveMs = NOW.getTime() - 120_000;
    const s = await readBackupStatus(
      [
        listing("local", async () => [
          { key: "waitron-20260905T115959Z.backup.enc", size: 1, mtimeMs: NOW.getTime() - 1000 },
          { key: "waitron-notes.txt", size: 1, mtimeMs: NOW.getTime() - 500 },
          { key: backupArchiveKey(new Date(archiveMs)), size: 1, mtimeMs: archiveMs },
        ]),
        listing("other", async () => [
          { key: "waitron-x.backup.enc", size: 1, mtimeMs: NOW.getTime() - 1000 },
        ]),
      ],
      60_000,
      NOW,
    );
    expect(s).toEqual({
      configured: true,
      destinations: [
        {
          id: "local",
          lastBackupAt: new Date(archiveMs).toISOString(),
          ageSeconds: 120,
          stale: true,
          readErrorCode: null,
        },
        { id: "other", lastBackupAt: null, ageSeconds: null, stale: true, readErrorCode: null },
      ],
    });
  });

  it("no backends → configured:false", async () => {
    expect(await readBackupStatus([], 60_000, NOW)).toEqual({ configured: false });
  });

  // Pins that the reader finds the sweep's real `.backup.enc` key, through the real backend.
  describe("against a real local-fs backend holding an encrypted archive", () => {
    let dir: string;
    afterEach(async () => {
      if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    });

    it("reads a waitron-<ts>-<uuid>.backup.enc object as FRESH", async () => {
      dir = mkdtempSync(join(tmpdir(), "backup-status-enc-"));
      const artifact = join(dir, backupArchiveKey(new Date("2026-09-05T11:59:00Z")));
      writeFileSync(artifact, "ciphertext");
      const mtime = new Date(NOW.getTime() - 30_000); // 30s old, well inside the 60s stale window
      await utimes(artifact, mtime, mtime);
      const be = buildBackupBackend({ kind: "local-fs", id: "primary", dir });
      const s = await readBackupStatus([be], 60_000, NOW);
      expect(s).toMatchObject({
        configured: true,
        destinations: [{ id: "primary", stale: false }],
      });
      const configured = s as Extract<typeof s, { configured: true }>;
      expect(configured.destinations[0]?.lastBackupAt).not.toBeNull();
    });
  });
});
