import { ADJUSTMENT_REFUND, ACTIVATION_ROWS, read, write } from "../test/setup-holdings-fixture.js";
// Imported first: its `vi.mock` of the internet clock must be in place before any fiscal module loads.
import { heldSetup } from "../test/held-setup-database.js";
import { root } from "../test/hour-recovery-host.js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
import { appendOnlyTriggers } from "@waitron/store";
import { readSetupDatabase } from "./first-setup-database-holdings.js";

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
  const result = await readSetupDatabase({ venueDir }, ALL_MODULES);
  expect(result).toMatchObject({
    kind: "read",
    holdings: { rows: 0, kept: 0, records: 0, accepted: 0 },
  });
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
