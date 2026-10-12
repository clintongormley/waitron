import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { readCalendarDays } from "./hours.js";
import { readOpeningHoursModel } from "./menu-timetable.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { readSpecialDaysModel } from "./named-days.js";
import { specialDates } from "./schema/hours.js";
import { specialDayDates, specialDays } from "./schema/seasons.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
const at = new Date("2026-10-09T10:00:00Z");

it.each(["calendar", "special days", "opening hours"] as const)(
  "%s reads its days after the station-hours tables are removed",
  async (reader) => {
    const rollback = new Error("roll back the schema probe");
    await expect(
      withTransaction(suite.db, async (tx) => {
        const [venue] = await tx
          .insert(locations)
          .values({
            name: randomUUID(),
            invoiceLocales: ["en-GB"],
            operationDescription: "Hospitality",
            timeZone: "Europe/Madrid",
            dayCutover: "06:00:00",
          })
          .returning();
        const cfg = { locationId: locationId(venue!.id) };
        await tx.insert(specialDates).values({
          locationId: cfg.locationId,
          date: "2026-10-10",
          name: "Annual closure",
          repeatOn: "10-10",
          kind: "holiday",
          closeWholeVenue: true,
        });
        const [special] = await tx
          .insert(specialDays)
          .values({ locationId: cfg.locationId, name: "Annual closure", repeatsYearly: true })
          .returning({ id: specialDays.id });
        await tx.insert(specialDayDates).values({
          specialDayId: special!.id,
          locationId: cfg.locationId,
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
          expect(await readCalendarDays(tx, cfg, "2027-10-10", "2027-10-10")).toEqual([
            calendarDay,
          ]);
        } else if (reader === "special days") {
          const model = await readSpecialDaysModel(tx, cfg, "2027-10-10", "2027-10-10", at);
          expect(model.days).toEqual([calendarDay]);
        } else {
          expect(await readOpeningHoursModel(tx, cfg, at)).not.toHaveProperty("namedDays");
        }
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  },
);
