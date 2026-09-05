import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupArchiveKey, dumpAtomic, dumpFileName, type PgDumpRunner } from "./pg-dump.js";

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
    // Same stamp as the staging dump for the same instant, so a run's files line up.
    expect(key).toBe(dumpFileName(at).replace(/\.dump$/, ".backup.enc"));
    // Shares the BACKUP_KEY_PREFIX the prune/status scans use, so it is pruned + read fresh.
    expect(key.startsWith("waitron-")).toBe(true);
  });
});

describe("dumpAtomic", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "waitron-dump-atomic-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("renames the .partial onto the final name only on success", async () => {
    const outFile = join(dir, "waitron-20260829T000000Z.dump");
    // The inner runner writes to whatever outFile it is handed — which dumpAtomic sets to `<final>.partial`.
    const inner: PgDumpRunner = async (args) => {
      expect(args.outFile).toBe(`${outFile}.partial`); // never writes the final name directly
      await writeFile(args.outFile, "PGDMP-bytes");
    };
    await dumpAtomic({ databaseUrl: "postgres://x", outFile }, inner);
    expect(await readFile(outFile, "utf8")).toBe("PGDMP-bytes"); // final exists, fully written
    expect((await readdir(dir)).sort()).toEqual(["waitron-20260829T000000Z.dump"]); // no .partial left
  });

  it("leaves NO final file and NO .partial when the inner dump fails mid-write", async () => {
    const outFile = join(dir, "waitron-20260829T000000Z.dump");
    // Simulate a dump killed mid-write: it wrote a partial, then threw (SIGTERM / disk-full).
    const inner: PgDumpRunner = async (args) => {
      await writeFile(args.outFile, "half-written");
      throw new Error("aborted");
    };
    await expect(dumpAtomic({ databaseUrl: "postgres://x", outFile }, inner)).rejects.toThrow(
      "aborted",
    );
    // Neither the final dump nor the .partial survives → readBackupStatus can never read it as fresh.
    expect(await readdir(dir)).toEqual([]);
  });

  it("rethrows and cleans up even when the inner never wrote a partial", async () => {
    const outFile = join(dir, "waitron-20260829T000000Z.dump");
    const inner: PgDumpRunner = () => Promise.reject(new Error("connect failed"));
    await expect(dumpAtomic({ databaseUrl: "postgres://x", outFile }, inner)).rejects.toThrow(
      "connect failed",
    );
    expect(await readdir(dir)).toEqual([]);
  });
});
