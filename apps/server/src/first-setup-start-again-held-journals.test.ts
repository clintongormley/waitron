import {
  extraDeletable,
  copyFails,
  snapshot,
  withoutSignIn,
  noConfirmations,
  venueDb,
  invoiceTable,
  labelOf,
  unreadableSummary,
  expectUnreadableDeleted,
  expectHeldRefused,
  keptRecords,
  dropTables,
  type Held,
} from "../test/start-again-held-fixture.js";
import { heldSetup } from "../test/held-setup-database.js";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { manifestSets } from "@waitron/migrations";
import { readStartAgainMarker } from "@waitron/provisioning";
import { foreignHotJournal, foreignWal } from "../test/foreign-journal.js";
import { checkpointed, damagePages } from "../test/damaged-database.js";

it("an intact held database with an invoice and another database's hot journal beside it is refused setup.not_ready, and nothing changes", async () => {
  const f = await heldSetup({ invoices: 1, recovery: false });
  foreignHotJournal(`${venueDb(f)}-journal`, "rolls-back");
  expect(await labelOf(f)).toBe("unknown");
  await expectHeldRefused(f, { code: "setup.not_ready" });
});

it("an intact held database with an invoice and an empty-original journal from another database beside it is refused setup.not_ready, and nothing changes", async () => {
  const f = await heldSetup({ invoices: 1, recovery: false });
  checkpointed(venueDb(f));
  foreignHotJournal(`${venueDb(f)}-journal`, "empty-original");
  await expectHeldRefused(f, {
    code: "setup.not_ready",
    reason: "journal beside a damaged read: no such table",
  });
});

it("a held database missing its invoice table: the summary says it cannot be read, and Start again with that confirmation deletes it", async () => {
  const f = await heldSetup({ recovery: false });
  dropTables(f, [invoiceTable]);
  const shown = await unreadableSummary(f);
  expect(shown).toEqual({ reached: "fiscal-finished", databaseUnreadable: true });
  await expectUnreadableDeleted(f, shown);
});

it("a held database missing a table beside a readable sale refuses kept-records, and deletes nothing", async () => {
  const f = await heldSetup({ invoices: 1, recovery: false });
  dropTables(f, ["department_days"]);
  await expectHeldRefused(f, keptRecords);
});

it.each([
  ["page-1", "partial"],
  ["other-pages", "corrupt"],
] as const)(
  "an intact held database with an invoice and another database's -wal beside it (%s, labelled %s) refuses kept-records, and deletes nothing",
  async (shape, label) => {
    const f = await heldSetup({ invoices: 1, recovery: false });
    checkpointed(venueDb(f));
    foreignWal(`${venueDb(f)}-wal`, shape);
    expect(await labelOf(f)).toBe(label);
    await expectHeldRefused(f, keptRecords);
  },
);

it("a damaged held database with no invoice and its own pending -wal: the summary says it cannot be read, and Start again with that confirmation deletes it", async () => {
  const f = await heldSetup({ pendingWal: true, recovery: false });
  const wal = await readFile(`${venueDb(f)}-wal`);
  damagePages(venueDb(f), "department_days");
  await writeFile(`${venueDb(f)}-wal`, wal);
  const shown = await unreadableSummary(f);
  expect(shown).toEqual({ reached: "fiscal-finished", databaseUnreadable: true });
  await expectUnreadableDeleted(f, shown);
});

it("an invoice record with the envios table missing refuses kept-records even when every append-only table is listed as deletable, and nothing changes", async () => {
  extraDeletable.set(
    "fiscal-verifactu",
    manifestSets().flatMap((set) => set.appendOnlyTables),
  );
  const f = await heldSetup({ invoices: 1, recovery: false });
  dropTables(f, ["envios"]);
  await expectHeldRefused(f, {
    ...keptRecords,
    reason: expect.stringMatching(/^rows=\d+ kept=0 records=1 accepted=0$/),
  });
});

it("with a readable held venue.db, a damaged node.db refuses the summary and Start again setup.not_ready, and nothing changes", async () => {
  const f = await heldSetup({ recovery: false });
  await writeFile(join(f.roots.venueDir, "node.db"), "not a database");
  await expectHeldRefused(f, { code: "setup.not_ready", reason: "node.db unreadable" });
});

it("control: without the journal, the same held database refuses kept-records", async () => {
  const f = await heldSetup({ invoices: 1, recovery: false });
  await expectHeldRefused(f, keptRecords);
});

it("a damaged held database whose private copy fails is refused setup.not_ready, and nothing changes", async () => {
  const f = await heldSetup({ pendingWal: true, recovery: false });
  const wal = await readFile(`${venueDb(f)}-wal`);
  damagePages(venueDb(f), "department_days");
  // The damage is written with the -wal checkpointed; putting it back keeps the copy path.
  await writeFile(`${venueDb(f)}-wal`, wal);
  copyFails.on = true;
  await expectHeldRefused(f, { code: "setup.not_ready", reason: "copy failed: ENOSPC" });
  expect(copyFails.calls).toBeGreaterThan(0);
});

it("a venue.db the box may not open is refused setup.not_ready, and nothing changes", async () => {
  const f = await heldSetup({ recovery: false });
  const before = await snapshot(f);
  await chmod(venueDb(f), 0o000);
  try {
    expect(await labelOf(f)).toBe("unreadable");
    const { ids, actions } = await withoutSignIn(f);
    await expect(actions.startAgainSummary(ids)).rejects.toMatchObject({ code: "setup.not_ready" });
    await expect(actions.startAgainFirstSetup(ids)).rejects.toMatchObject({
      code: "setup.not_ready",
    });
  } finally {
    await chmod(venueDb(f), 0o644);
  }
  expect(await snapshot(f)).toEqual(before);
  expect(await readStartAgainMarker(f.roots.venueDir)).toBeNull();
  await noConfirmations(f);
});

it.each([
  ["with an invoice", { invoices: 1 }, keptRecords],
  ["without one", {}, { code: "setup.not_ready" }],
] as const)(
  "a readable held database labelled corrupt %s refuses as its contents say, and nothing changes",
  async (_label, options, refusal) => {
    const f = await heldSetup({ ...options, recovery: false });
    const inspect = f.host.resolution.inspectFirstSetupResolution;
    const host = {
      ...f.host,
      resolution: {
        ...f.host.resolution,
        inspectFirstSetupResolution: async () => ({
          ...(await inspect()),
          database: "corrupt" as const,
        }),
      },
    } as Held["host"];
    await expectHeldRefused(f, refusal, host);
  },
);

it.each([
  ["saved trading settings", { tradingSettings: true }, "trading-settings"],
  ["a finished setup", { status: "complete" }, "setup-finished"],
] as const)(
  "%s beside a damaged database refuse %s, and nothing changes",
  async (_label, options, cause) => {
    const f = await heldSetup({ ...options, recovery: false });
    damagePages(venueDb(f), "department_days");
    await expectHeldRefused(f, { code: "setup.start_again_refused", params: { cause } });
  },
);
