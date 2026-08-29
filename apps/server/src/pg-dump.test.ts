import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dumpFileName, pruneOldDumps } from "./pg-dump.js";

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
});
