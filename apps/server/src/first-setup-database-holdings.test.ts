// Imported first: its `vi.mock` of the internet clock must be in place before any fiscal module loads.
import { heldSetup } from "../test/held-setup-database.js";
import { root } from "../test/hour-recovery-host.js";
import * as fileSystem from "node:fs/promises";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
import { appendOnlyTriggers } from "@waitron/store";
import { MODULE } from "../test/first-fiscal.js";
import { readSetupDatabaseHoldings } from "./first-setup-database-holdings.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, mkdtemp: vi.fn(actual.mkdtemp) };
});
afterEach(() => vi.restoreAllMocks());

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

it("reads a legitimate held setup: every activation row, nothing kept, no invoice", async () => {
  const held = await heldSetup();
  const result = await read(held);
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
  await expect(read(held)).rejects.toMatchObject({ code: "setup.not_ready" });
});

it("answers setup.not_ready when the database file cannot be read", async () => {
  const held = await heldSetup({ recovery: false });
  await writeFile(join(held.roots.venueDir, "venue.db"), "not a database");
  await expect(read(held)).rejects.toMatchObject({ code: "setup.not_ready" });
});

it("answers setup.not_ready when a module that sets a floor has no history reader", async () => {
  const held = await heldSetup({ recovery: false });
  const modules = held.host.modules!.map((module) => {
    if (module.name !== MODULE) return module;
    const initialSetup = { ...module.provisioning!.initialSetup! };
    delete initialSetup.startAgainHistory;
    return { ...module, provisioning: { ...module.provisioning!, initialSetup } };
  });
  await expect(read(held, modules)).rejects.toMatchObject({ code: "setup.not_ready" });
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
  write(held, [
    `insert into adjustment_refunds (id, adjustment_id, tender_refund_id, amount, created_at)
       values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
               '00000000-0000-4000-8000-000000000003', 1, '2026-10-28T00:00:00.000Z')`,
  ]);
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
