import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  businessDayStart,
  currentBusinessDay,
  readLocationClock,
  validatedRangeWindow,
  venueMomentAt,
} from "./business-day.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const locationId = "a495-location";
const clock = {
  timeZone: "Europe/Madrid",
  dayCutover: "05:00",
  cutoverChanges: [{ effectiveBusinessDay: "2026-11-04", dayCutover: "03:00" }],
};
beforeEach(async () => {
  await suite.db
    .insert(locations)
    .values({
      id: locationId,
      name: "Clock",
      invoiceLocales: ["es"],
      operationDescription: "Restaurant",
      timeZone: "Europe/Madrid",
      dayCutover: "05:00:00",
    });
});
afterEach(() => vi.useRealTimers());
describe("complete reporting clock", () => {
  it("reads explicit empty history alongside the initial setting", async () => {
    expect(await readLocationClock(suite.db, locationId)).toEqual({
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
      cutoverChanges: [],
    });
  });
  it("reads retained rules in date order without replacing the baseline", async () => {
    await withTransaction(suite.db, async (tx) => {
      await tx.execute(
        sql`insert into location_day_cutover_changes (location_id, effective_business_day, day_cutover) values (${locationId}, '2026-12-01', '07:00:00'), (${locationId}, '2026-11-04', '03:00:00')`,
      );
    });
    expect(await readLocationClock(suite.db, locationId)).toEqual({
      ...clock,
      cutoverChanges: [
        ...clock.cutoverChanges,
        { effectiveBusinessDay: "2026-12-01", dayCutover: "07:00" },
      ],
    });
  });
  it.each([
    ["2026-11-04T01:59:59.999Z", 1],
    ["2026-11-04T02:00:00.000Z", 0],
    ["2026-11-03T03:59:59.999Z", 0],
    ["2026-11-03T04:00:00.000Z", 1],
  ])("ends the preceding day's report at the new boundary: %s", async (at, expected) => {
    const window = validatedRangeWindow({
      ...clock,
      fromBusinessDay: "2026-11-03",
      toBusinessDay: "2026-11-03",
    });
    const { rows } = await suite.db.execute<{ included: number }>(
      sql`select ${window(sql`${at}`)} as included`,
    );
    expect(rows[0]!.included).toBe(expected);
  });
  it("uses separate timeline boundaries for a multi-day report", async () => {
    const window = validatedRangeWindow({
      ...clock,
      fromBusinessDay: "2026-11-02",
      toBusinessDay: "2026-11-04",
    });
    const { rows } = await suite.db.execute(
      sql`select ${window(sql`'2026-11-05T02:00:00.000Z'`)} as included`,
    );
    expect(rows).toEqual([{ included: 0 }]);
  });
  it("uses the timeline for current day, venue moment and backup lower bound", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T02:00:00.000Z"));
    expect(currentBusinessDay(clock)).toBe("2026-11-04");
    expect(venueMomentAt(new Date(), clock)).toEqual({
      businessDay: "2026-11-04",
      weekday: 3,
      timeOfDay: "03:00",
    });
    expect(businessDayStart(new Date(), clock)).toBe("2026-11-04T02:00:00.000Z");
  });
});
