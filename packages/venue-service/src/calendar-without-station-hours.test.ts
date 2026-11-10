import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  specialDayDates,
  specialDays,
  venueLocationId,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { readCalendarDays } from "./hours.js";
import { readOpeningHoursModel } from "./menu-timetable.js";
import { readSpecialDaysModel } from "./named-days.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
});
const at = new Date("2026-10-09T10:00:00Z");

it.each(["calendar", "special days", "opening hours"] as const)(
  "%s reads its days after the station-hours tables are removed",
  async (reader) => {
    const rollback = new Error("roll back the schema probe");
    await expect(
      withTransaction(suite.db, async (tx) => {
        await seedVenue(tx, {
          name: randomUUID(),
          invoiceLocales: ["en-GB"],
          operationDescription: "Hospitality",
          timeZone: "Europe/Madrid",
          dayCutover: "06:00:00",
        });
        {
          locationId: await venueLocationId(tx);
        }
        const [special] = await tx
          .insert(specialDays)
          .values({ name: "Annual closure", repeatsYearly: true })
          .returning({ id: specialDays.id });
        await tx.insert(specialDayDates).values({
          specialDayId: special!.id,
          date: "2026-10-10",
          closedAllDay: true,
        });
        await tx.run(sql`drop table if exists hours_week_periods`);
        await tx.run(sql`drop table if exists hours_week_cells`);
        await tx.run(sql`drop table if exists special_date_hours_periods`);
        await tx.run(sql`drop table if exists special_date_hours`);
        const calendarDay = {
          date: "2027-10-10",
          specialDay: { id: special!.id, name: "Annual closure" },
          holidays: [],
          tone: "special_day",
          closed: true,
        };
        if (reader === "calendar") {
          expect(await readCalendarDays(tx, "2027-10-10", "2027-10-10")).toEqual([calendarDay]);
        } else if (reader === "special days") {
          const model = await readSpecialDaysModel(tx, "2027-10-10", "2027-10-10", at);
          expect(model.days).toEqual([calendarDay]);
        } else {
          expect(await readOpeningHoursModel(tx, at)).not.toHaveProperty("namedDays");
        }
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  },
);
