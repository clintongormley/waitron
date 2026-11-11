import { seedVenueSettings, seedBusinessDay } from "@waitron/db/testing/seed.js";
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  CHECK_VIOLATION,
  UNIQUE_VIOLATION,
  isRefusal,
  locations,
  withTransaction,
} from "../index.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "../testing/venue-db.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const locationId = "a495-location";
beforeEach(async () => {
  await suite.db.insert(locations).values({
    id: locationId,
  });
  await seedVenueSettings(suite.db, {
    name: "Clock",
    invoiceLocales: ["es"],
    operationDescription: "Restaurant",
  });
  await seedBusinessDay(suite.db, {});
});
const change = (_location: string, date: string, cutover: string) =>
  withTransaction(suite.db, async (tx) => {
    await tx.execute(
      sql`insert into day_cutover_changes ( effective_business_day, day_cutover) values (${date}, ${cutover})`,
    );
  });
const revision = (_location: string, value: number) =>
  withTransaction(suite.db, async (tx) => {
    await tx.execute(sql`update settings set revision = ${value} where module = 'business_day'`);
  });
async function refused(action: () => Promise<unknown>, codes: readonly number[]) {
  const error = await action().then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(isRefusal(error, codes)).toBe(true);
}

describe("persisted business-day clock", () => {
  it("stores the baseline separately from dated starts and the revision", async () => {
    const { rows } = await suite.db.execute<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name in ('day_cutover_changes', 'location_day_cutover_changes', 'location_business_day_settings') order by name`,
    );
    expect(rows.map((row) => row.name)).toEqual(["day_cutover_changes"]);
    await change(locationId, "2026-11-04", "03:00:00");
    await revision(locationId, 2);
    expect(
      (
        await suite.db.execute(
          sql`select effective_business_day, day_cutover from day_cutover_changes where effective_business_day > '2000-01-01'`,
        )
      ).rows,
    ).toEqual([{ effective_business_day: "2026-11-04", day_cutover: "03:00:00" }]);
    expect(
      (await suite.db.execute(sql`select revision from settings where module = 'business_day'`))
        .rows,
    ).toEqual([{ revision: 2 }]);
    expect(
      suite.db.all(
        sql`select day_cutover from day_cutover_changes where effective_business_day = '2000-01-01'`,
      ),
    ).toEqual([{ day_cutover: "06:00:00" }]);
  });
  it("refuses a duplicate date for the venue", async () => {
    await change(locationId, "2026-11-04", "03:00:00");
    await refused(() => change(locationId, "2026-11-04", "07:00:00"), UNIQUE_VIOLATION);
  });
  it("refuses a duplicate revision row", async () => {
    await refused(
      async () =>
        await suite.db.execute(
          sql`insert into settings select * from settings where module = 'business_day'`,
        ),
      UNIQUE_VIOLATION,
    );
  });
  it.each(["2026-1-04", "2026-11-4", "2026-aa-04", "2026-11-04extra"])(
    "refuses malformed date %s",
    async (date) => {
      await refused(() => change(locationId, date, "03:00:00"), CHECK_VIOLATION);
    },
  );
  it.each(["3:00:00", "24:00:00", "03:60:00", "03:00:01", "03:00", "aa:00:00"])(
    "refuses malformed cutover %s",
    async (cutover) => {
      await refused(() => change(locationId, "2026-11-04", cutover), CHECK_VIOLATION);
    },
  );
  it.each([-1, 0.5])("refuses revision %s", async (value) => {
    await refused(() => revision(locationId, value), CHECK_VIOLATION);
  });
});
