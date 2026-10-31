import {
  ACTIVATION_ROWS,
  read,
  files,
  withHoldings,
  mainFile,
  PRIVATE_COPY,
} from "../test/setup-holdings-fixture.js";
import { heldSetup } from "../test/held-setup-database.js";
import * as fileSystem from "node:fs/promises";
import { access, copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";

it("reads a legitimate held setup in place: every activation row, nothing kept, no invoice", async () => {
  const held = await heldSetup();
  vi.mocked(fileSystem.mkdtemp).mockClear();
  const result = await read(held);
  expect(fileSystem.mkdtemp).not.toHaveBeenCalled();
  expect(result).toMatchObject({ rows: ACTIVATION_ROWS, kept: 0, records: 0, accepted: 0 });
});

it("counts an invoice as a record and as a kept row", async () => {
  const held = await heldSetup({ invoices: 1 });
  const result = await read(held);
  expect(result.records).toBe(1);
  expect(result.kept).toBeGreaterThanOrEqual(1);
});

it("leaves the original files' names and bytes unchanged", async () => {
  const held = await heldSetup();
  const before = await files(held.roots.venueDir);
  await read(held);
  expect(await files(held.roots.venueDir)).toEqual(before);
});

it("reads a row committed only in the -wal through a private copy, leaving the originals unchanged", async () => {
  const held = await heldSetup({ pendingWal: true });
  const before = await files(held.roots.venueDir);
  expect(before.map(([name]) => name)).toContain("venue.db-wal");
  const result = await read(held);
  expect(result.rows).toBe(ACTIVATION_ROWS + 1);
  expect(await files(held.roots.venueDir)).toEqual(before);
});

it("answers setup.not_ready when the private copy cannot be written", async () => {
  const held = await heldSetup({ pendingWal: true });
  vi.mocked(fileSystem.mkdtemp).mockRejectedValueOnce(
    Object.assign(new Error("no space"), { code: "ENOSPC" }),
  );
  await expect(read(held)).rejects.toMatchObject({
    code: "setup.not_ready",
    reason: "copy failed: ENOSPC",
  });
});

it("answers setup.not_ready when the private copy cannot be removed", async () => {
  const held = await heldSetup({ pendingWal: true });
  let copy: string | undefined;
  const modules = withHoldings(held, async (db) => {
    // The seat also reads the main file alone, which is not the copy.
    const file = await mainFile(db);
    if (PRIVATE_COPY.test(file)) copy = file;
    return { records: 0, accepted: 0 };
  });
  vi.mocked(fileSystem.rm).mockRejectedValueOnce(
    Object.assign(new Error("busy"), { code: "EBUSY" }),
  );
  await expect(read(held, modules)).rejects.toMatchObject({
    code: "setup.not_ready",
    reason: "copy not removed: EBUSY",
  });
  expect(copy).toMatch(/waitron-setup-holdings-/);
  await rm(dirname(copy!), { recursive: true, force: true });
});

it("keeps a failed read as the reason when the private copy then cannot be removed", async () => {
  const held = await heldSetup({ pendingWal: true });
  let copy: string | undefined;
  const modules = withHoldings(held, async (db) => {
    copy = await mainFile(db);
    throw Object.assign(new Error("seat failed"), { code: "ESEAT" });
  });
  vi.mocked(fileSystem.rm).mockRejectedValueOnce(
    Object.assign(new Error("busy"), { code: "EBUSY" }),
  );
  await expect(read(held, modules)).rejects.toMatchObject({
    code: "setup.not_ready",
    reason: "read failed: ESEAT",
  });
  await rm(dirname(copy!), { recursive: true, force: true });
});

it("passes on a module seat's error code, never its reason", async () => {
  const held = await heldSetup({ recovery: false });
  const modules = withHoldings(held, async () => {
    throw new AppError("setup.attempt_invalid", {}, { reason: "a value read from the database" });
  });
  await expect(read(held, modules)).rejects.toMatchObject({
    code: "setup.not_ready",
    reason: "read failed: setup.attempt_invalid",
  });
});

it("refuses a write through the private copy and through the main file read alone", async () => {
  const held = await heldSetup({ pendingWal: true });
  const refusals: [string, unknown][] = [];
  const modules = withHoldings(held, async (db) => {
    const file = await mainFile(db);
    try {
      await db.execute("create table seat_write (a)");
      refusals.push([file, undefined]);
    } catch (error) {
      refusals.push([file, error]);
    }
    return { records: 0, accepted: 0 };
  });
  await read(held, modules);
  expect(refusals.map(([file]) => file)).toEqual([
    expect.stringMatching(PRIVATE_COPY),
    expect.not.stringMatching(PRIVATE_COPY),
  ]);
  for (const [, refusal] of refusals) expect(String(refusal)).toMatch(/readonly/);
});

it.each([
  ["succeeds", async () => ({ records: 0, accepted: 0 })],
  [
    "throws",
    async () => {
      throw new Error("seat failed");
    },
  ],
])("deletes its private copy when the read %s", async (outcome, answer) => {
  const held = await heldSetup({ pendingWal: true });
  let copy: string | undefined;
  const modules = withHoldings(held, async (db) => {
    const file = await mainFile(db);
    if (PRIVATE_COPY.test(file)) copy = file;
    return answer();
  });
  const reading = read(held, modules);
  if (outcome === "throws")
    await expect(reading).rejects.toMatchObject({ code: "setup.not_ready" });
  else await reading;
  expect(copy).toMatch(/waitron-setup-holdings-/);
  expect(copy).not.toBe(join(held.roots.venueDir, "venue.db"));
  await expect(access(copy!)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(dirname(copy!))).rejects.toMatchObject({ code: "ENOENT" });
});

it("reads through a private copy, read-write, when a leftover -journal sits beside the database", async () => {
  const held = await heldSetup({ recovery: false });
  const path = join(held.roots.venueDir, "venue.db");
  // A journal left by a writer that stopped mid-transaction: it must be rolled back to be read.
  const aside = await mkdtemp(join(tmpdir(), "held-setup-journal-"));
  try {
    const db = new DatabaseSync(path);
    // Spilling pages to the file writes the journal's header, which is what makes it hot.
    db.exec("pragma journal_mode = delete; pragma cache_size = 2; begin");
    db.exec(`create table filler (b blob); insert into filler select randomblob(4000) from
      (with recursive c(x) as (select 1 union all select x + 1 from c where x < 200) select x from c)`);
    await copyFile(path, join(aside, "venue.db"));
    await copyFile(`${path}-journal`, join(aside, "venue.db-journal"));
    db.exec("rollback");
    db.close();
    for (const name of ["venue.db", "venue.db-journal"])
      await copyFile(join(aside, name), join(held.roots.venueDir, name));
  } finally {
    await rm(aside, { recursive: true, force: true });
  }
  const before = await files(held.roots.venueDir);
  vi.mocked(fileSystem.mkdtemp).mockClear();
  const result = await read(held);
  expect(fileSystem.mkdtemp).toHaveBeenCalledTimes(1);
  expect(result.rows).toBe(ACTIVATION_ROWS);
  expect(await files(held.roots.venueDir)).toEqual(before);
});
