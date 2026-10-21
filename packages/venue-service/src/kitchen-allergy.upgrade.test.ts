import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  installChangeFeed,
  kitchenStations,
  locations,
  parties,
  workingOrders,
  workingOrderLines,
  ticketItems,
  printers,
  printJobs,
  kitchenPrintJobs,
  kitchenPrintJobLines,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { applyMigrations } from "@waitron/migrations";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { VENUE_SERVICE_CHANGE_SOURCES } from "./classification.js";
import { savePartyAllergy, setAllergyLineTicks } from "./party-allergy.js";

const predecessor = mkdtempSync(join(tmpdir(), "kitchen-allergy-predecessor-"));
afterAll(() => rmSync(predecessor, { recursive: true, force: true }));
cpSync(VENUE_SERVICE_MIGRATIONS.migrationsFolder, predecessor, { recursive: true });
const journalPath = join(predecessor, "meta", "_journal.json");
const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
const introduced = journal.entries.findIndex(({ tag }) =>
  /CREATE TABLE `ticket_item_allergies`/.test(
    readFileSync(join(predecessor, `${tag}.sql`), "utf8"),
  ),
);
if (introduced >= 0) {
  for (const entry of journal.entries.splice(introduced))
    rmSync(join(predecessor, `${entry.tag}.sql`));
  writeFileSync(journalPath, JSON.stringify(journal));
}
const suite = useVenueDb({
  resetPerTest: false,
  migrations: [
    CORE_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    { ...VENUE_SERVICE_MIGRATIONS, migrationsFolder: predecessor },
  ],
});

it("A669 storage upgrades populated kitchen work and restores boot change feeds without inventing originals", async () => {
  await seedTenant(suite.db);
  const actor = randomUUID();
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Predecessor room",
      invoiceLocales: ["en"],
      operationDescription: "Restaurant",
    })
    .returning();
  const nodeId = await seedNode(suite.db, locationId(location!.id));
  const [station] = await suite.db
    .insert(kitchenStations)
    .values({ locationId: location!.id, name: "Old grill" })
    .returning();
  const [party] = await suite.db
    .insert(parties)
    .values({ openedBy: actor, name: "Old guests" })
    .returning();
  const [order] = await suite.db
    .insert(workingOrders)
    .values({
      locationId: location!.id,
      partyId: party!.id,
      source: "dashboard",
      orderNumber: 23,
    })
    .returning();
  const [dish] = await suite.db
    .insert(workingOrderLines)
    .values({
      workingOrderId: order!.id,
      lineNo: 1,
      name: "Old dish",
      descriptions: { en: "Customer dish" },
      kitchenName: "OLD GRILL",
      quantity: 2000,
      unitPriceGross: 800,
      lineTotal: 1600,
      vatClass: "reduced",
    })
    .returning();
  const [extra] = await suite.db
    .insert(workingOrderLines)
    .values({
      workingOrderId: order!.id,
      parentLineId: dish!.id,
      lineNo: 2,
      name: "Old extra",
      descriptions: { en: "Customer extra" },
      quantity: 1000,
      unitPriceGross: 100,
      lineTotal: 100,
      vatClass: "reduced",
    })
    .returning();
  const [ticket] = await suite.db
    .insert(ticketItems)
    .values({
      nodeId,
      workingOrderId: order!.id,
      workingOrderLineId: dish!.id,
      stationId: station!.id,
      quantity: 2000,
      firedAt: "2026-10-19T10:00:00Z",
      state: "preparing",
      preparingAt: "2026-10-19T10:01:00Z",
    })
    .returning();
  await suite.db.insert(ticketItems).values({
    nodeId,
    workingOrderId: order!.id,
    workingOrderLineId: extra!.id,
    stationId: station!.id,
    quantity: 1000,
    firedAt: "2026-10-19T10:00:00Z",
  });
  const [printer] = await suite.db
    .insert(printers)
    .values({
      locationId: location!.id,
      name: "Old printer",
      transport: "network_tcp",
      host: "192.0.2.10",
    })
    .returning();
  const [job] = await suite.db
    .insert(printJobs)
    .values({
      locationId: location!.id,
      printerId: printer!.id,
      payload: Uint8Array.of(27, 64, 79, 76, 68),
      status: "done",
    })
    .returning();
  await suite.db.insert(kitchenPrintJobs).values({
    printJobId: job!.id,
    workingOrderId: order!.id,
    stationId: station!.id,
    reprint: false,
  });
  await suite.db
    .insert(kitchenPrintJobLines)
    .values({ printJobId: job!.id, workingOrderLineId: dish!.id });
  const saved = await withTransaction(suite.db, (tx) =>
    savePartyAllergy(
      tx,
      party!.id,
      0,
      {
        answer: "allergies",
        guests: [{ who: "Old guest", allergens: { eggs: {} }, note: "Separate pan" }],
      },
      actor,
    ),
  );
  await withTransaction(suite.db, (tx) =>
    setAllergyLineTicks(tx, party!.id, [{ guestId: saved.guests[0]!.id, workingLineId: dish!.id }]),
  );
  await suite.db.execute(sql`insert into service_commands
    (id, scope_kind, scope_id, submission_id, kind, fingerprint, result, created_at)
    values (${randomUUID()}, 'party', ${party!.id}, ${randomUUID()}, 'allergy', 'old-fingerprint', '{"value":{"revision":1}}', '2026-10-19T10:00:00Z')`);
  for (const kind of ["recalled", "void", "changed", "moved", "rerouted"]) {
    for (const acknowledged of [false, true]) {
      await suite.db.execute(sql`insert into kitchen_notices
        (id, station_id, working_order_id, order_label, kind, line_name, quantity, created_at,
         acknowledged_at, direction, cancelled_extra, moved_to, rerouted_to, order_note_change)
        values (${randomUUID()}, ${station!.id}, ${order!.id}, '#23', ${kind}, 'OLD GRILL', 1000,
         '2026-10-19T10:00:00Z', ${acknowledged ? "2026-10-19T10:10:00Z" : null},
         ${kind === "changed" ? "removed" : null}, ${kind === "changed" ? "Old garnish" : null},
         ${kind === "moved" ? "Table 8" : null}, ${kind === "rerouted" ? "Cold" : null}, ${null})`);
    }
  }
  const tables = suite.db
    .all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table'
    and name not glob 'sqlite_*' and name not glob '__drizzle_migrations*' and name <> 'change_log' order by name`,
    )
    .map(({ name }) => name);
  expect(tables).not.toContain("ticket_item_allergies");
  const snapshot = () =>
    new Map(
      tables.map((name) => {
        if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`Unsafe fixture table: ${name}`);
        return [
          name,
          suite.db.all<Record<string, unknown>>(sql.raw(`select * from "${name}" order by rowid`)),
        ];
      }),
    );
  const before = snapshot();
  const sources = VENUE_SERVICE_CHANGE_SOURCES.filter((source) => tables.includes(source.table));
  await installChangeFeed(suite.db, sources);
  const triggersBefore = suite.db.all<{ name: string; sql: string }>(
    sql`select name, sql from sqlite_master where type = 'trigger' order by name`,
  );
  const inbound = suite.db.all(sql`select m.name, f.* from sqlite_master m,
    pragma_foreign_key_list(m.name) f where m.type = 'table' and f."table" = 'kitchen_notices'`);
  expect(inbound).toEqual([]);
  expect(suite.db.all(sql`pragma foreign_keys`)).toEqual([{ foreign_keys: 1 }]);
  const [{ file }] = suite.db.all<{ file: string }>(sql`pragma database_list`);
  await applyMigrations(dirname(file!), [VENUE_SERVICE_MIGRATIONS]);
  expect(suite.db.all(sql`pragma foreign_keys`)).toEqual([{ foreign_keys: 1 }]);
  expect(
    suite.db
      .all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)
      .map(({ name }) => name),
  ).toContain("ticket_item_allergies");
  await installChangeFeed(suite.db, VENUE_SERVICE_CHANGE_SOURCES);
  const after = snapshot();
  const upgradedNotices = after.get("kitchen_notices")!;
  expect(upgradedNotices).toHaveLength(10);
  expect(upgradedNotices.every((row) => row.allergy_block === null)).toBe(true);
  after.set(
    "kitchen_notices",
    upgradedNotices.map((row) => {
      const oldColumns = { ...row };
      delete oldColumns.allergy_block;
      return oldColumns;
    }),
  );
  expect(after).toEqual(before);
  expect(suite.db.all(sql`select * from ticket_item_allergies`)).toEqual([]);
  const triggersAfter = suite.db.all<{ name: string; sql: string }>(
    sql`select name, sql from sqlite_master where type = 'trigger' order by name`,
  );
  const laterColumnDrops = new Map([
    [
      "waitron_change_menu_periods_update",
      ' or new."end_offset_minutes" is not old."end_offset_minutes"',
    ],
  ]);
  expect(
    triggersAfter.filter(
      ({ name, sql: text }) =>
        !text.includes('"ticket_item_allergies"') &&
        name !== "waitron_change_kitchen_notices_update",
    ),
  ).toEqual(
    triggersBefore
      .filter(({ name }) => name !== "waitron_change_kitchen_notices_update")
      .map(({ name, sql: text }) => {
        const dropped = laterColumnDrops.get(name);
        if (dropped === undefined) return { name, sql: text };
        expect(text).toContain(dropped);
        return { name, sql: text.replace(dropped, "") };
      }),
  );
  expect(
    triggersAfter.find(({ name }) => name === "waitron_change_kitchen_notices_update")?.sql,
  ).toContain('new."allergy_block" is not old."allergy_block"');
  expect(
    triggersAfter.filter(({ sql: text }) => text.includes('"ticket_item_allergies"')),
  ).toHaveLength(3);
  expect(suite.db.all(sql`pragma foreign_key_check`)).toEqual([]);
  const block = {
    who: "New guest",
    allergens: { eggs: {} },
    clashes: {},
    note: null,
    labels: {
      en: { avoids: ["Eggs"], clashes: [] },
      es: { avoids: ["Frozen eggs label"], clashes: [] },
    },
  };
  await suite.db
    .execute(sql`insert into ticket_item_allergies(ticket_item_id, original_block, current_block)
    values (${ticket!.id}, ${JSON.stringify(block)}, ${JSON.stringify(block)})`);
  for (const kind of ["allergy_changed", "allergy_removed"]) {
    await suite.db.execute(sql`insert into kitchen_notices
      (id, station_id, working_order_id, order_label, kind, line_name, quantity, created_at, allergy_block)
      values (${randomUUID()}, ${station!.id}, ${order!.id}, '#23', ${kind}, 'OLD GRILL', 1000,
      '2026-10-20T10:00:00Z', ${kind === "allergy_changed" ? JSON.stringify(block) : null})`);
  }
  expect(
    suite.db.all(
      sql`select kind, allergy_block from kitchen_notices where kind like 'allergy_%' order by rowid`,
    ),
  ).toEqual([
    { kind: "allergy_changed", allergy_block: JSON.stringify(block) },
    { kind: "allergy_removed", allergy_block: null },
  ]);
  expect(suite.db.all(sql`pragma foreign_key_check`)).toEqual([]);
});
