import { beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, locations, withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId as brandLocationId, type LocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { seasons } from "./schema/seasons.js";
import { ensureDefaultSeasons, readSeasons } from "./seasons.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function newLocation(name: string): Promise<LocationId> {
  const [row] = await db
    .insert(locations)
    .values({ name, invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
    .returning({ id: locations.id });
  return brandLocationId(row!.id);
}

const shape = (rows: { name: string; startsOn: string }[]) =>
  rows.map(({ name, startsOn }) => ({ name, startsOn }));

describe("ensureDefaultSeasons", () => {
  it("gives a location the four default seasons once, however often it runs", async () => {
    const locationId = await newLocation("Four seasons");
    const first = await withTransaction(db, (tx) => ensureDefaultSeasons(tx, { locationId }));
    const second = await withTransaction(db, (tx) => ensureDefaultSeasons(tx, { locationId }));
    const expected = [
      { name: "Spring", startsOn: "03-01" },
      { name: "Summer", startsOn: "06-01" },
      { name: "Autumn", startsOn: "09-01" },
      { name: "Winter", startsOn: "12-01" },
    ];
    expect(shape(first)).toEqual(expected);
    expect(second).toEqual(first);
    const stored = await withTransaction(db, (tx) => readSeasons(tx, { locationId }));
    expect(stored).toEqual(first);
  });

  it("leaves a location that already has a season alone", async () => {
    const locationId = await newLocation("One season");
    const [own] = await db
      .insert(seasons)
      .values({ locationId, name: "All year", startsOn: "01-01" })
      .returning({ id: seasons.id });
    const result = await withTransaction(db, (tx) => ensureDefaultSeasons(tx, { locationId }));
    expect(result).toEqual([{ id: own!.id, name: "All year", startsOn: "01-01" }]);
    expect(await withTransaction(db, (tx) => readSeasons(tx, { locationId }))).toEqual(result);
  });

  it("reads only the asked location's seasons, ordered by start", async () => {
    const mine = await newLocation("Mine");
    const other = await newLocation("Other");
    await db.insert(seasons).values([
      { locationId: mine, name: "Late", startsOn: "10-01" },
      { locationId: mine, name: "Early", startsOn: "02-01" },
      { locationId: other, name: "Theirs", startsOn: "05-01" },
    ]);
    const read = await withTransaction(db, (tx) => readSeasons(tx, { locationId: mine }));
    expect(shape(read)).toEqual([
      { name: "Early", startsOn: "02-01" },
      { name: "Late", startsOn: "10-01" },
    ]);
  });
});
