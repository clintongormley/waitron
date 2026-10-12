import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ArchiveReadBudget, readArchiveStateFile } from "./archive-read-budget.js";
import { collectStateParts } from "./archive-entries.js";
import { collectModuleNonDbState } from "./backup-sources.js";
import { collectOptionalStateFiles } from "./backup-optional-state.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import { ARCHIVE_MAX_METADATA_BYTES } from "./backup-archive-file.js";
import { FILE_CHUNK_BYTES } from "./artifact-file-io.js";
import type { WaitronModule } from "@waitron/module";

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), "archive-budget-"));
  dirs.push(dir);
  return dir;
}
const refusal = (reason: string) => ({ code: "backup.archive_invalid", params: { reason } });
it("refuses metadata totals, entry count and UTF-8 name bytes before a read", () => {
  const budget = new ArchiveReadBudget();
  budget.addEntry("one", ARCHIVE_MAX_METADATA_BYTES);
  expect(() => budget.addEntry("two", 1)).toThrowError(
    expect.objectContaining(refusal("metadata_too_large")),
  );
  const count = new ArchiveReadBudget();
  for (let i = 0; i < 4096; i++) count.addEntry(String(i), 0);
  expect(() => count.addEntry("extra", 0)).toThrowError(
    expect.objectContaining(refusal("entry_count_too_large")),
  );
  expect(() => new ArchiveReadBudget().addEntry("é".repeat(2049), 0)).toThrowError(
    expect.objectContaining(refusal("name_too_large")),
  );
});
it("reads bounded chunks and refuses a file growing past the remaining budget", async () => {
  const dir = await fresh();
  const path = join(dir, "state");
  await writeFile(path, "old");
  const handle = await open(path, "r");
  const prototype = Object.getPrototypeOf(handle) as typeof handle;
  const realStat = prototype.stat;
  const realRead = prototype.read;
  await handle.close();
  let grew = false;
  vi.spyOn(prototype, "stat").mockImplementation(async function (
    this: typeof handle,
    ...args: Parameters<typeof realStat>
  ) {
    const info = await realStat.apply(this, args);
    if (!grew) {
      grew = true;
      await writeFile(path, "12345");
    }
    return info;
  });
  const reads: number[] = [];
  vi.spyOn(prototype, "read").mockImplementation(async function (
    this: typeof handle,
    ...args: Parameters<typeof realRead>
  ) {
    reads.push((args as unknown as [Buffer, number, number])[2]);
    return realRead.apply(this, args);
  });
  const budget = new ArchiveReadBudget();
  budget.addEntry("previous", ARCHIVE_MAX_METADATA_BYTES - 4);
  await expect(readArchiveStateFile(path, budget, "state")).rejects.toMatchObject(
    refusal("metadata_too_large"),
  );
  expect(reads.length).toBeGreaterThan(0);
  expect(Math.max(...reads)).toBeLessThanOrEqual(FILE_CHUNK_BYTES);
  expect(await readFile(path, "utf8")).toBe("12345");
});
it("shares the bound across required and optional state before accepting a scheduled capture", async () => {
  const dir = await fresh();
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(dir, "tls"));
  for (const rel of RECOVERY_FILES) await writeFile(join(dir, rel), "x");
  const large = await open(join(dir, "backup.env"), "w");
  await large.truncate(ARCHIVE_MAX_METADATA_BYTES);
  await large.close();
  await expect(
    collectStateParts({ stateDir: dir, modules: [], resolvers: {} }, new ArchiveReadBudget()),
  ).rejects.toMatchObject(refusal("metadata_too_large"));
});
it("bounds module state and optional state while retaining small legitimate bytes", async () => {
  const dir = await fresh();
  await writeFile(join(dir, "a"), "small");
  const module = {
    name: "fake",
    version: "0.0.0",
    tier: "toggleable",
    migrations: { name: "fake", table: "__fake", from: "./fake" },
    backup: { nonDbState: [{ kind: "content-addressed-dir", source: "documents" }] },
  } as WaitronModule;
  const budget = new ArchiveReadBudget();
  expect(await collectModuleNonDbState([module], { documents: dir }, budget)).toEqual([
    { name: "documents/a", bytes: Buffer.from("small") },
  ]);
  expect(await collectOptionalStateFiles(dir, ["a", "absent"], budget)).toEqual({ a: "small" });
  const full = new ArchiveReadBudget();
  full.addEntry("previous", ARCHIVE_MAX_METADATA_BYTES - 4);
  await expect(collectModuleNonDbState([module], { documents: dir }, full)).rejects.toMatchObject(
    refusal("metadata_too_large"),
  );
});
