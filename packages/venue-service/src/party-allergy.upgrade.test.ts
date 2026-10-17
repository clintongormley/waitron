import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  installChangeFeed,
  locations,
  parties,
  orderDrafts,
  orderDraftLines,
  workingOrders,
  workingOrderLines,
  withTransaction,
} from "@waitron/db";
import { applyMigrationSet, useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { VENUE_SERVICE_CHANGE_SOURCES } from "./classification.js";
import { readPartyAllergy, savePartyAllergy, setAllergyLineTicks } from "./party-allergy.js";

const predecessor = mkdtempSync(join(tmpdir(), "party-allergy-predecessor-"));
afterAll(() => rmSync(predecessor, { recursive: true, force: true }));
cpSync(VENUE_SERVICE_MIGRATIONS.migrationsFolder, predecessor, { recursive: true });
const journalPath = join(predecessor, "meta", "_journal.json");
const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
const introduced = journal.entries.findIndex(({ tag }) =>
  /CREATE TABLE `party_allergy`/.test(readFileSync(join(predecessor, `${tag}.sql`), "utf8")),
);
if (introduced < 0) throw new Error("Missing party allergy introduction");
for (const entry of journal.entries.splice(introduced))
  rmSync(join(predecessor, `${entry.tag}.sql`));
writeFileSync(journalPath, JSON.stringify(journal));
// Stops at this migration: a later table rebuild drops that table's change-feed triggers, which
// the server's start reinstalls (`installChangeFeed`, apps/server/src/boot.ts).
const upgraded = mkdtempSync(join(tmpdir(), "party-allergy-upgraded-"));
afterAll(() => rmSync(upgraded, { recursive: true, force: true }));
cpSync(VENUE_SERVICE_MIGRATIONS.migrationsFolder, upgraded, { recursive: true });
const upgradedJournalPath = join(upgraded, "meta", "_journal.json");
const upgradedJournal = JSON.parse(readFileSync(upgradedJournalPath, "utf8")) as {
  entries: { tag: string }[];
};
for (const entry of upgradedJournal.entries.splice(introduced + 1))
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

it("upgrades a populated predecessor with change-feed triggers, preserving every seeded row and trigger", async () => {
  await seedTenant(suite.db);
  const actor = "aaaaaaaa-1111-4111-8111-111111111111";
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Before allergy", invoiceLocales: ["en"], operationDescription: "Restaurant" })
    .returning();
  const [party] = await suite.db
    .insert(parties)
    .values({ openedBy: actor, name: "Original party" })
    .returning();
  const [order] = await suite.db
    .insert(workingOrders)
    .values({ source: "dashboard", locationId: location!.id, partyId: party!.id, orderNumber: 7 })
    .returning();
  const [dish] = await suite.db
    .insert(workingOrderLines)
    .values({
      workingOrderId: order!.id,
      lineNo: 1,
      name: "Original dish",
      descriptions: { en: "Customer dish" },
      quantity: 1000,
      unitPriceGross: 600,
      lineTotal: 600,
      vatClass: "reduced",
    })
    .returning();
  const [draft] = await suite.db
    .insert(orderDrafts)
    .values({ partyId: party!.id, ownerId: actor })
    .returning();
  const [line] = await suite.db
    .insert(orderDraftLines)
    .values({
      draftId: draft!.id,
      position: 1,
      menuItemId: "aaaaaaaa-2222-4222-8222-222222222222",
      options: [],
      extras: [],
      quantity: 2000,
    })
    .returning();
  const tables = new Set(
    suite.db
      .all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)
      .map((r) => r.name),
  );
  expect(tables.has("party_allergy")).toBe(false);
  await installChangeFeed(
    suite.db,
    VENUE_SERVICE_CHANGE_SOURCES.filter((source) => tables.has(source.table)),
  );
  const triggers = suite.db.all(
    sql`select name, sql from sqlite_master where type = 'trigger' order by name`,
  );
  await applyMigrationSet(suite.db, { ...VENUE_SERVICE_MIGRATIONS, migrationsFolder: upgraded });
  expect(await suite.db.select().from(locations)).toEqual([location]);
  expect(await suite.db.select().from(parties)).toEqual([party]);
  expect(await suite.db.select().from(workingOrders)).toEqual([order]);
  expect(await suite.db.select().from(workingOrderLines)).toEqual([dish]);
  expect(await suite.db.select().from(orderDrafts)).toEqual([draft]);
  expect(await suite.db.select().from(orderDraftLines)).toEqual([line]);
  expect(
    suite.db.all(sql`select name, sql from sqlite_master where type = 'trigger' order by name`),
  ).toEqual(triggers);
  const saved = await withTransaction(suite.db, (tx) =>
    savePartyAllergy(
      tx,
      party!.id,
      0,
      { answer: "allergies", guests: [{ who: "Window seat", allergens: { eggs: {} } }] },
      actor,
    ),
  );
  await withTransaction(suite.db, (tx) =>
    setAllergyLineTicks(tx, party!.id, [
      { guestId: saved.guests[0]!.id, draftLineId: line!.id },
      { guestId: saved.guests[0]!.id, workingLineId: dish!.id },
    ]),
  );
  const snapshot = await withTransaction(suite.db, (tx) => readPartyAllergy(tx, party!.id));
  expect(snapshot.ticks).toHaveLength(2);
  expect(snapshot.guests[0]).toMatchObject({ who: "Window seat", allergens: { eggs: {} } });
});
