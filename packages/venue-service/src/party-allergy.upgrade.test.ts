import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
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
import { seedVenue, seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { historicalSet } from "../../../scripts/fixtures/a760-history/historical-set.mjs";
import { VENUE_SERVICE_CHANGE_SOURCES } from "./classification.js";
import { readPartyAllergy, savePartyAllergy, setAllergyLineTicks } from "./party-allergy.js";

/** Removes `entries`' SQL from `folder`; answers the append-only tables less those it created. */
function removeMigrations(folder: string, entries: readonly { tag: string }[]): string[] {
  const created = new Set<string>();
  for (const { tag } of entries) {
    const file = join(folder, `${tag}.sql`);
    for (const [, name] of readFileSync(file, "utf8").matchAll(/CREATE TABLE `(\w+)`/g))
      created.add(name!);
    rmSync(file);
  }
  return (historicalSet("venue-service").appendOnlyTables ?? []).filter(
    (name) => !created.has(name),
  );
}

const predecessor = mkdtempSync(join(tmpdir(), "party-allergy-predecessor-"));
afterAll(() => rmSync(predecessor, { recursive: true, force: true }));
cpSync(historicalSet("venue-service").migrationsFolder, predecessor, { recursive: true });
const journalPath = join(predecessor, "meta", "_journal.json");
const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
const introduced = journal.entries.findIndex(({ tag }) =>
  /CREATE TABLE `party_allergy`/.test(readFileSync(join(predecessor, `${tag}.sql`), "utf8")),
);
if (introduced < 0) throw new Error("Missing party allergy introduction");
const predecessorAppendOnly = removeMigrations(predecessor, journal.entries.splice(introduced));
writeFileSync(journalPath, JSON.stringify(journal));
// Stops at this migration: a later table rebuild drops that table's change-feed triggers, which
// the server's start reinstalls (`installChangeFeed`, apps/server/src/boot.ts).
const upgraded = mkdtempSync(join(tmpdir(), "party-allergy-upgraded-"));
afterAll(() => rmSync(upgraded, { recursive: true, force: true }));
cpSync(historicalSet("venue-service").migrationsFolder, upgraded, { recursive: true });
const upgradedJournalPath = join(upgraded, "meta", "_journal.json");
const upgradedJournal = JSON.parse(readFileSync(upgradedJournalPath, "utf8")) as {
  entries: { tag: string }[];
};
const upgradedAppendOnly = removeMigrations(
  upgraded,
  upgradedJournal.entries.splice(introduced + 1),
);
writeFileSync(upgradedJournalPath, JSON.stringify(upgradedJournal));
const suite = useVenueDb({
  resetPerTest: false,
  migrations: [
    historicalSet("core"),
    historicalSet("catalogue"),
    {
      ...historicalSet("venue-service"),
      migrationsFolder: predecessor,
      appendOnlyTables: predecessorAppendOnly,
    },
  ],
});

it("upgrades a populated predecessor with change-feed triggers, preserving every seeded row and trigger", async () => {
  const actor = "aaaaaaaa-1111-4111-8111-111111111111";
  await seedVenue(suite.db, {
    name: "Before allergy",
    invoiceLocales: ["en"],
    operationDescription: "Restaurant",
  });
  const [location] = await suite.db.select().from(locations);
  const [party] = await suite.db
    .insert(parties)
    .values({ openedBy: actor, name: "Original party" })
    .returning();
  const order = await seedWorkingOrder(suite.db, {
    source: "dashboard",
    partyId: party!.id,
    orderNumber: 7,
  });
  const [dish] = await suite.db
    .insert(workingOrderLines)
    .values({
      workingOrderId: order.id,
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
  await applyMigrationSet(suite.db, {
    ...historicalSet("venue-service"),
    migrationsFolder: upgraded,
    appendOnlyTables: upgradedAppendOnly,
  });
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
