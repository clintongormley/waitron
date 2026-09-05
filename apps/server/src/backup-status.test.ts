import { mkdtempSync, writeFileSync } from "node:fs";
import { rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readBackupStatus } from "./backup-status.js";
import { buildBackend } from "./local-fs-backend.js";
import type { StorageBackend, StoredObject } from "./storage-backend.js";

const backend = (id: string, newestMtimeMs: number | null): StorageBackend => ({
  id,
  put: async () => {},
  get: async () => Buffer.alloc(0),
  delete: async () => {},
  list: async (): Promise<StoredObject[]> =>
    newestMtimeMs === null
      ? []
      : [{ key: "waitron-x.backup.enc", size: 1, mtimeMs: newestMtimeMs }],
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
        },
        { id: "b", lastBackupAt: null, ageSeconds: null, stale: true },
      ],
    });
  });

  it("no backends → configured:false", async () => {
    expect(await readBackupStatus([], 60_000, NOW)).toEqual({ configured: false });
  });

  // Regression guard (BR-1 → BR-2): the sweep writes `waitron-<ts>.backup.enc` (BR-1 wrote
  // `.dump.enc`), which the pre-BR-1 `DUMP_FILE_NAME = /^waitron-.*\.dump$/` filter did NOT match, so
  // box-status reported the backup PERMANENTLY STALE while backups were landing. Scanning the real
  // `LocalFsBackend.list("waitron-")` (prefix match, suffix-agnostic) must read a `.backup.enc` archive
  // as FRESH. Fails against the old `.dump`-anchored reader.
  describe("against a real local-fs backend holding an encrypted archive", () => {
    let dir: string;
    afterEach(async () => {
      if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    });

    it("reads a waitron-<ts>.backup.enc object as FRESH", async () => {
      dir = mkdtempSync(join(tmpdir(), "backup-status-enc-"));
      const artifact = join(dir, "waitron-20260905T115900Z.backup.enc");
      writeFileSync(artifact, "ciphertext");
      const mtime = new Date(NOW.getTime() - 30_000); // 30s old, well inside the 60s stale window
      await utimes(artifact, mtime, mtime);
      const be = buildBackend({ kind: "local-fs", id: "primary", dir });
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
