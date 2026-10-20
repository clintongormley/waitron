import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  installChangeFeed,
  kitchenStations,
  locations,
  workingOrderLines,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import { applyMigrationSet, useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { VENUE_SERVICE_CHANGE_SOURCES } from "./classification.js";
import { kitchenNotices } from "./schema/kitchen-notices.js";
import { readKitchenNotes, writeKitchenNote } from "./order-kitchen-notes.js";

const predecessor = mkdtempSync(join(tmpdir(), "kitchen-note-predecessor-"));
afterAll(() => rmSync(predecessor, { recursive: true, force: true }));
cpSync(VENUE_SERVICE_MIGRATIONS.migrationsFolder, predecessor, { recursive: true });
const journalPath = join(predecessor, "meta", "_journal.json");
const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
const introduced = journal.entries.findIndex(({ tag }) =>
  /CREATE TABLE `order_kitchen_notes`/.test(readFileSync(join(predecessor, `${tag}.sql`), "utf8")),
);
if (introduced < 0) throw new Error("Missing whole-order kitchen note introduction");
for (const entry of journal.entries.splice(introduced))
  rmSync(join(predecessor, `${entry.tag}.sql`));
writeFileSync(journalPath, JSON.stringify(journal));
// Stops at the migration adding `order_note_change`, the last this test is about: a later table
// rebuild drops that table's change-feed triggers, which the server's start reinstalls
// (`installChangeFeed`, apps/server/src/boot.ts).
const upgraded = mkdtempSync(join(tmpdir(), "kitchen-note-upgraded-"));
afterAll(() => rmSync(upgraded, { recursive: true, force: true }));
cpSync(VENUE_SERVICE_MIGRATIONS.migrationsFolder, upgraded, { recursive: true });
const upgradedJournalPath = join(upgraded, "meta", "_journal.json");
const upgradedJournal = JSON.parse(readFileSync(upgradedJournalPath, "utf8")) as {
  entries: { tag: string }[];
};
const changeIntroduced = upgradedJournal.entries.findIndex(({ tag }) =>
  /ALTER TABLE `kitchen_notices` ADD `order_note_change`/.test(
    readFileSync(join(upgraded, `${tag}.sql`), "utf8"),
  ),
);
if (changeIntroduced < 0) throw new Error("Missing kitchen note change introduction");
for (const entry of upgradedJournal.entries.splice(changeIntroduced + 1))
  rmSync(join(upgraded, `${entry.tag}.sql`));
writeFileSync(upgradedJournalPath, JSON.stringify(upgradedJournal));
const suite = useVenueDb({
  resetPerTest: false,
  migrations: [
    CORE_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    { ...VENUE_SERVICE_MIGRATIONS, migrationsFolder: predecessor },
  ],
});

it("adds order instructions to a populated predecessor without changing its dish notes, notices or triggers", async () => {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Existing restaurant",
      invoiceLocales: ["es-ES"],
      operationDescription: "Restaurante",
    })
    .returning();
  const [station] = await suite.db
    .insert(kitchenStations)
    .values({ locationId: location!.id, name: "Kitchen" })
    .returning();
  const [order] = await suite.db
    .insert(workingOrders)
    .values({ locationId: location!.id, source: "dashboard", orderNumber: 42 })
    .returning();
  const [line] = await suite.db
    .insert(workingOrderLines)
    .values({
      workingOrderId: order!.id,
      lineNo: 1,
      name: "Burger",
      kitchenName: "BRGR",
      descriptions: { "es-ES": "Hamburguesa" },
      quantity: 1000,
      unitPriceGross: 1200,
      vatClass: "reduced",
      lineTotal: 1200,
      note: "No onions",
    })
    .returning();
  await suite.db.execute(sql`insert into kitchen_notices
    (id, station_id, working_order_id, order_label, kind, line_name, quantity, note, created_at)
    values ('existing-notice', ${station!.id}, ${order!.id}, '#42', 'recalled', 'BRGR', 1000, 'No onions', '2026-10-15T12:00:00Z')`);
  const tables = new Set(
    suite.db
      .all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)
      .map((r) => r.name),
  );
  await installChangeFeed(
    suite.db,
    VENUE_SERVICE_CHANGE_SOURCES.filter((s) => tables.has(s.table)),
  );
  const triggers = suite.db.all<{ name: string; sql: string }>(
    sql`select name, sql from sqlite_master where type = 'trigger' order by name`,
  );
  expect(triggers.some((t) => t.name.startsWith("waitron_change_"))).toBe(true);
  expect(triggers.some((t) => t.name.includes("append_only"))).toBe(true);
  expect(tables.has("order_kitchen_notes")).toBe(false);
  expect(
    suite.db
      .all<{ name: string }>(sql`select name from pragma_table_info('kitchen_notices')`)
      .map((r) => r.name),
  ).not.toContain("order_note_change");

  await applyMigrationSet(suite.db, { ...VENUE_SERVICE_MIGRATIONS, migrationsFolder: upgraded });

  expect(await suite.db.select().from(locations)).toEqual([location]);
  expect(await suite.db.select().from(workingOrderLines)).toEqual([line]);
  expect(await suite.db.select().from(workingOrders)).toEqual([order]);
  // Keep this historical projection independent of columns introduced by later migrations.
  expect(
    await suite.db
      .select({
        id: kitchenNotices.id,
        kind: kitchenNotices.kind,
        lineName: kitchenNotices.lineName,
        note: kitchenNotices.note,
        orderNoteChange: kitchenNotices.orderNoteChange,
      })
      .from(kitchenNotices),
  ).toEqual([
    expect.objectContaining({
      id: "existing-notice",
      kind: "recalled",
      lineName: "BRGR",
      note: "No onions",
      orderNoteChange: null,
    }),
  ]);
  expect(
    suite.db.all(sql`select name, sql from sqlite_master where type = 'trigger' order by name`),
  ).toEqual(triggers);
  const scope = { workingOrderId: order!.id };
  expect(
    await withTransaction(suite.db, (tx) => writeKitchenNote(tx, scope, 0, "All together")),
  ).toEqual({ note: "All together", revision: 1 });
  expect(
    (await withTransaction(suite.db, (tx) => readKitchenNotes(tx, [scope]))).get(
      `order:${order!.id}`,
    ),
  ).toEqual({ note: "All together", revision: 1 });
});
