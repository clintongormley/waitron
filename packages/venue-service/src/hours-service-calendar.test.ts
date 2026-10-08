import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  catalogues,
  kitchenStations,
  locations,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { readCalendarDays, readHoursModel, replaceWeekHours, saveSpecialDate } from "./hours.js";
import { replaceMenuWeek, saveMenuPeriod, saveSpecialDateMenus } from "./menu-timetable.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { hoursWeekCells, specialDateHours, specialDates } from "./schema/hours.js";
import { menuDayTimetables, menuSlots } from "./schema/menus.js";
import { departments } from "./schema/service.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
const at = new Date("2026-10-06T10:00:00Z");

async function fixture() {
  return withTransaction(suite.db, async (tx) => {
    const [venue] = await tx
      .insert(locations)
      .values({
        name: randomUUID(),
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
        timeZone: "Europe/Madrid",
        dayCutover: "04:30:00",
      })
      .returning();
    const cfg = { locationId: locationId(venue!.id) };
    const [department, inactive] = await tx
      .insert(departments)
      .values([
        {
          locationId: cfg.locationId,
          name: "Dining",
          tradingName: "Dining",
          defaultServiceMode: "table_tab",
          isDefault: true,
        },
        {
          locationId: cfg.locationId,
          name: "Terrace",
          tradingName: "Terrace",
          defaultServiceMode: "table_tab",
          active: false,
        },
      ])
      .returning();
    const [station] = await tx
      .insert(kitchenStations)
      .values({ locationId: cfg.locationId, name: "Bar" })
      .returning();
    const [menu] = await tx.insert(catalogues).values({ name: randomUUID() }).returning();
    const period = await saveMenuPeriod(tx, cfg, department!.id, {
      name: "Late",
      menuId: menu!.id,
      staffMenuIds: [],
    });
    const week = (weekday: number) =>
      [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        weekday: day,
        slots: day === weekday ? [{ periodId: period.id, startsAt: "22:00", endsAt: "03:00" }] : [],
      }));
    await replaceMenuWeek(tx, cfg, department!.id, week(1), at);
    const inactivePeriod = await saveMenuPeriod(tx, cfg, inactive!.id, {
      name: "Terrace",
      menuId: menu!.id,
      staffMenuIds: [],
    });
    await replaceMenuWeek(
      tx,
      cfg,
      inactive!.id,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [{ periodId: inactivePeriod.id, startsAt: "04:30", endsAt: "04:30" }],
      })),
      at,
    );
    return {
      cfg,
      department: department!.id,
      inactive: inactive!.id,
      station: station!.id,
      period: period.id,
      week,
    };
  });
}

const tones = async (cfg: Awaited<ReturnType<typeof fixture>>["cfg"], from: string, to = from) =>
  withTransaction(suite.db, async (tx) => ({
    calendar: (await readCalendarDays(tx, cfg, from, to)).map((day) => day.tone),
    model: (await readHoursModel(tx, cfg, from, to, at)).days.map((day) => day.tone),
  }));

describe("station-hours calendar follows department service periods", () => {
  it("uses business-day ranges rather than midnight tails or station hours", async () => {
    const f = await fixture();
    await withTransaction(suite.db, (tx) =>
      replaceWeekHours(
        tx,
        f.cfg,
        { kind: "station", id: f.station },
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          cell: { mode: "all_day", periods: [] },
        })),
        at,
      ),
    );
    expect(await tones(f.cfg, "2026-10-19", "2026-10-20")).toEqual({
      calendar: ["standard", "closed"],
      model: ["standard", "closed"],
    });
  });

  it("ignores retained department-hour rows in both the week and a special date", async () => {
    const f = await fixture();
    await withTransaction(suite.db, async (tx) => {
      await tx
        .insert(hoursWeekCells)
        .values({ departmentId: f.department, weekday: 2, mode: "all_day" });
      const special = await saveSpecialDate(
        tx,
        f.cfg,
        null,
        {
          date: "2026-10-20",
          name: "Retained hours",
          colour: "red",
          closeWholeVenue: false,
          cells: [],
        },
        at,
      );
      await tx
        .insert(specialDateHours)
        .values({ specialDateId: special.id, departmentId: f.department, mode: "all_day" });
    });
    expect(await tones(f.cfg, "2026-10-20")).toEqual({ calendar: ["closed"], model: ["closed"] });
    expect(await tones(f.cfg, "2026-10-27")).toEqual({ calendar: ["closed"], model: ["closed"] });
  });

  it("uses an explicit empty special-day timetable, and falls back to the week when absent", async () => {
    const f = await fixture();
    await withTransaction(suite.db, async (tx) => {
      const special = await saveSpecialDate(
        tx,
        f.cfg,
        null,
        {
          date: "2026-10-19",
          name: "Closed Monday",
          colour: "green",
          closeWholeVenue: false,
          cells: [],
        },
        at,
      );
      await tx.update(specialDates).set({ ownHours: true }).where(eq(specialDates.id, special.id));
      await saveSpecialDateMenus(tx, f.cfg, special.id, f.department, [], at);
      await saveSpecialDate(
        tx,
        f.cfg,
        null,
        {
          date: "2026-10-26",
          name: "Normal Monday",
          colour: "purple",
          closeWholeVenue: false,
          cells: [],
        },
        at,
      );
    });
    expect(await tones(f.cfg, "2026-10-19")).toEqual({ calendar: ["closed"], model: ["closed"] });
    expect(await tones(f.cfg, "2026-10-26")).toEqual({ calendar: ["blue"], model: ["blue"] });
  });

  it("uses special-day ranges to open a closed weekday, and whole-venue closure wins", async () => {
    const f = await fixture();
    await withTransaction(suite.db, async (tx) => {
      for (const [date, closeWholeVenue] of [
        ["2026-10-20", false],
        ["2026-10-27", true],
      ] as const) {
        const special = await saveSpecialDate(
          tx,
          f.cfg,
          null,
          { date, name: "Special Tuesday", colour: "blue", closeWholeVenue, cells: [] },
          at,
        );
        await tx
          .update(specialDates)
          .set({ ownHours: !closeWholeVenue })
          .where(eq(specialDates.id, special.id));
        if (closeWholeVenue) {
          const [day] = await tx
            .insert(menuDayTimetables)
            .values({ departmentId: f.department, specialDateId: special.id })
            .returning();
          await tx.insert(menuSlots).values({
            timetableId: day!.id,
            departmentId: f.department,
            periodId: f.period,
            startsAt: "10:00:00",
            endsAt: "14:00:00",
          });
        } else {
          await saveSpecialDateMenus(
            tx,
            f.cfg,
            special.id,
            f.department,
            [{ periodId: f.period, startsAt: "10:00", endsAt: "14:00" }],
            at,
          );
        }
      }
    });
    expect(await tones(f.cfg, "2026-10-20")).toEqual({ calendar: ["blue"], model: ["blue"] });
    expect(await tones(f.cfg, "2026-10-27")).toEqual({ calendar: ["closed"], model: ["closed"] });
  });

  it("ignores inactive departments and other venues, and closes when no active department is open", async () => {
    const f = await fixture();
    const other = await fixture();
    await withTransaction(suite.db, (tx) =>
      replaceMenuWeek(tx, other.cfg, other.department, other.week(2), at),
    );
    expect(await tones(f.cfg, "2026-10-20")).toEqual({ calendar: ["closed"], model: ["closed"] });
    await suite.db
      .update(departments)
      .set({ active: false })
      .where(eq(departments.id, f.department));
    expect(await tones(f.cfg, "2026-10-19")).toEqual({ calendar: ["closed"], model: ["closed"] });
  });
});
