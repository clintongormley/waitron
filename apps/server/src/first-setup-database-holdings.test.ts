// Imported first: its `vi.mock` of the internet clock must be in place before any fiscal module loads.
import { heldSetup } from "../test/held-setup-database.js";
import { root } from "../test/hour-recovery-host.js";
import * as fileSystem from "node:fs/promises";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { AppError } from "@waitron/shared";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { Database } from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import { appendOnlyTriggers } from "@waitron/store";
import { MODULE } from "../test/first-fiscal.js";
import { readSetupDatabaseHoldings } from "./first-setup-database-holdings.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, mkdtemp: vi.fn(actual.mkdtemp), rm: vi.fn(actual.rm) };
});
afterEach(() => vi.restoreAllMocks());

const ADJUSTMENT_REFUND = `insert into adjustment_refunds
  (id, adjustment_id, tender_refund_id, amount, created_at)
  values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
          '00000000-0000-4000-8000-000000000003', 1, '2026-10-28T00:00:00.000Z')`;

// The rows a real activation stopped at `committed` leaves with the helper's module set.
const ACTIVATION_ROWS = 105;

type Held = Pick<Awaited<ReturnType<typeof heldSetup>>, "roots" | "host">;
function read(held: Held, modules: readonly WaitronModule[] = held.host.modules!) {
  return held.host.resolution.withVenueExclusion(() =>
    readSetupDatabaseHoldings(held.roots, modules),
  );
}
async function files(dir: string) {
  const entries = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile());
  return Promise.all(
    entries
      .map(({ name }) => name)
      .sort()
      .map(async (name) => [name, await readFile(join(dir, name))] as const),
  );
}
/** Writes beside the reader, with foreign keys off, so a single row needs no parent rows. */
function write(held: Held, statements: readonly string[]) {
  const db = new DatabaseSync(join(held.roots.venueDir, "venue.db"));
  try {
    db.exec("pragma foreign_keys = off");
    for (const statement of statements) db.exec(statement);
  } finally {
    db.close();
  }
}

/** The fiscal module with its holdings seat replaced. */
function withHoldings(
  held: Held,
  seat: (db: Pick<Database, "execute">) => Promise<{ records: number; accepted: number }>,
) {
  return held.host.modules!.map((module) =>
    module.name !== MODULE
      ? module
      : {
          ...module,
          provisioning: {
            ...module.provisioning!,
            initialSetup: { ...module.provisioning!.initialSetup!, startAgainHoldings: seat },
          },
        },
  );
}
async function mainFile(db: Pick<Database, "execute">) {
  const rows = (await db.execute<{ name: string; file: string }>("pragma database_list")).rows;
  return rows.find((row) => row.name === "main")!.file;
}

it("reads a legitimate held setup in place: every activation row, nothing kept, no invoice", async () => {
  const held = await heldSetup();
  vi.mocked(fileSystem.mkdtemp).mockClear();
  const result = await read(held);
  expect(fileSystem.mkdtemp).not.toHaveBeenCalled();
  expect(result).toMatchObject({ rows: ACTIVATION_ROWS, kept: 0, records: 0, accepted: 0 });
  expect(Object.keys(result.history)).toEqual([MODULE]);
  expect(JSON.stringify(result.history[MODULE])).toContain(held.installationName);
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
    copy = await mainFile(db);
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

it("refuses a write through the private copy", async () => {
  const held = await heldSetup({ pendingWal: true });
  let refusal: unknown;
  const modules = withHoldings(held, async (db) => {
    expect(await mainFile(db)).toMatch(/waitron-setup-holdings-/);
    try {
      await db.execute("create table seat_write (a)");
    } catch (error) {
      refusal = error;
    }
    return { records: 0, accepted: 0 };
  });
  await read(held, modules);
  expect(String(refusal)).toMatch(/readonly/);
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
    copy = await mainFile(db);
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

it("answers setup.not_ready when the database file cannot be read", async () => {
  const held = await heldSetup({ recovery: false });
  await writeFile(join(held.roots.venueDir, "venue.db"), "not a database");
  await expect(read(held)).rejects.toMatchObject({
    code: "setup.not_ready",
    reason: expect.stringMatching(/^read failed: ERR_SQLITE_ERROR/),
  });
});

it("answers setup.not_ready when a module that sets a floor has no history reader", async () => {
  const held = await heldSetup({ recovery: false });
  const modules = held.host.modules!.map((module) => {
    if (module.name !== MODULE) return module;
    const initialSetup = { ...module.provisioning!.initialSetup! };
    delete initialSetup.startAgainHistory;
    return { ...module, provisioning: { ...module.provisioning!, initialSetup } };
  });
  await expect(read(held, modules)).rejects.toMatchObject({
    code: "setup.not_ready",
    reason: `history reader missing: ${MODULE}`,
  });
});

it("sums records and accepted filings over every module with a holdings seat", async () => {
  const held = await heldSetup({ recovery: false });
  const stub = {
    name: "stub-holdings",
    provisioning: {
      initialSetup: { startAgainHoldings: async () => ({ records: 0, accepted: 2 }) },
    },
  } as unknown as WaitronModule;
  const result = await read(held, [stub, ...held.host.modules!]);
  expect(result).toMatchObject({ records: 0, accepted: 2 });
});

it("adds a holdings seat's records to the next module's", async () => {
  const held = await heldSetup({ recovery: false });
  const stub = {
    name: "stub-holdings",
    provisioning: {
      initialSetup: { startAgainHoldings: async () => ({ records: 1, accepted: 2 }) },
    },
  } as unknown as WaitronModule;
  const result = await read(held, [stub, ...held.host.modules!]);
  expect(result).toMatchObject({ records: 1, accepted: 2 });
});

it("does not count Litestream's own tables", async () => {
  const held = await heldSetup({ recovery: false });
  write(held, [
    "create table _litestream_seq (id integer primary key, seq integer)",
    "insert into _litestream_seq values (1, 1)",
    "create table _litestream_lock (id integer)",
    "insert into _litestream_lock values (1)",
  ]);
  expect((await read(held)).rows).toBe(ACTIVATION_ROWS);
});

it("keeps a row in a manifest append-only table whose triggers are gone", async () => {
  const held = await heldSetup({ recovery: false });
  write(held, [
    ...appendOnlyTriggers(["adjustment_refunds"]).map(({ name }) => `drop trigger "${name}"`),
    ADJUSTMENT_REFUND,
  ]);
  expect(await read(held)).toMatchObject({ rows: ACTIVATION_ROWS + 1, kept: 1 });
});

it("reads an empty migrated database as holding no rows", async () => {
  const venueDir = join(root, "empty-venue");
  await mkdir(venueDir);
  await applyMigrations(venueDir, migrationOptionsFor(manifestSets(), null));
  const result = await readSetupDatabaseHoldings({ venueDir }, ALL_MODULES);
  expect(result).toMatchObject({ rows: 0, kept: 0, records: 0, accepted: 0 });
});

it("keeps a row in an append-only table of a manifest module that is not enabled", async () => {
  const held = await heldSetup({ recovery: false });
  write(held, [ADJUSTMENT_REFUND]);
  const modules = held.host.modules!.filter((module) => module.name !== "adjustments");
  expect(modules).toHaveLength(held.host.modules!.length - 1);
  const result = await read(held, modules);
  expect(result).toMatchObject({ rows: ACTIVATION_ROWS + 1, kept: 1 });
});

it("keeps a row in a table that carries the append-only triggers but is in no manifest set", async () => {
  const held = await heldSetup({ recovery: false });
  write(held, [
    "create table stray_ledger (id integer primary key)",
    ...appendOnlyTriggers(["stray_ledger"]).map(({ definition }) => `create trigger ${definition}`),
    "insert into stray_ledger (id) values (1)",
  ]);
  const result = await read(held);
  expect(result).toMatchObject({ rows: ACTIVATION_ROWS + 1, kept: 1 });
});
