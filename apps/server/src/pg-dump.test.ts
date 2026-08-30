import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dumpAtomic, dumpFileName, pruneOldDumps, type PgDumpRunner } from "./pg-dump.js";

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

describe("pruneOldDumps", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "waitron-pg-dump-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps the newest `retain` dumps, unlinks the rest, ignores non-matching files", async () => {
    const dumps = [
      "waitron-20260825T000000Z.dump",
      "waitron-20260826T000000Z.dump",
      "waitron-20260827T000000Z.dump",
      "waitron-20260828T000000Z.dump",
      "waitron-20260829T000000Z.dump",
    ];
    for (const name of dumps) await writeFile(join(dir, name), "x");
    await writeFile(join(dir, "other.txt"), "keep me");

    await pruneOldDumps(dir, 2);

    const remaining = (await readdir(dir)).sort();
    expect(remaining).toEqual([
      "other.txt",
      "waitron-20260828T000000Z.dump",
      "waitron-20260829T000000Z.dump",
    ]);
  });

  it("tolerates a missing directory", async () => {
    await expect(pruneOldDumps(join(dir, "does-not-exist"), 2)).resolves.toBeUndefined();
  });

  it("skips a directory named like a dump (no EISDIR throw) and keeps it", async () => {
    // A subdir that matches DUMP_FILE_NAME must be left alone, not unlinked — the isFile guard.
    await mkdir(join(dir, "waitron-20260801T000000Z.dump"));
    await writeFile(join(dir, "waitron-20260829T000000Z.dump"), "x");
    await expect(pruneOldDumps(dir, 1)).resolves.toBeUndefined(); // no EISDIR throw
    const remaining = (await readdir(dir)).sort();
    // The real dump (newest, within retain=1) is kept; the look-alike DIR is skipped, not deleted.
    expect(remaining).toContain("waitron-20260801T000000Z.dump");
    expect(remaining).toContain("waitron-20260829T000000Z.dump");
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
