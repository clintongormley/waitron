import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, catalogues, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { readCalendarDays, saveSpecialDate } from "./hours.js";
import { readNamedDaysModel } from "./named-days.js";
import { replaceMenuWeek, saveMenuPeriod, saveSpecialDateMenus } from "./menu-timetable.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { specialDates } from "./schema/hours.js";
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
          isDefault: true,
        },
        {
          locationId: cfg.locationId,
          name: "Terrace",
          tradingName: "Terrace",
          active: false,
        },
      ])
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
      period: period.id,
      week,
    };
  });
}

const tones = async (cfg: Awaited<ReturnType<typeof fixture>>["cfg"], from: string, to = from) =>
  withTransaction(suite.db, async (tx) => {
    const calendar = await readCalendarDays(tx, cfg, from, to);
    const model = await readNamedDaysModel(tx, cfg, from, to, at);
    return {
      calendar: calendar.map((day) => day.tone),
      model: model.days.map((day) => day.tone),
      closed: model.days.map((day) => day.closed),
    };
  });

describe("calendar follows department service periods", () => {
  it("uses business-day ranges rather than midnight tails", async () => {
    const f = await fixture();
    expect(await tones(f.cfg, "2026-10-19", "2026-10-20")).toEqual({
      calendar: ["standard", "closed"],
      model: ["standard", "closed"],
      closed: [false, true],
    });
  });

  it("keeps a named day without its own timetable closed like the standard week", async () => {
    const f = await fixture();
    await withTransaction(suite.db, async (tx) => {
      await saveSpecialDate(
        tx,
        f.cfg,
        null,
        {
          date: "2026-10-20",
          name: "Named Tuesday",
          closeWholeVenue: false,
          cells: [],
        },
        at,
      );
    });
    expect(await tones(f.cfg, "2026-10-20")).toEqual({
      calendar: ["closed"],
      model: ["working_day"],
      closed: [true],
    });
    expect(await tones(f.cfg, "2026-10-27")).toEqual({
      calendar: ["closed"],
      model: ["closed"],
      closed: [true],
    });
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
          closeWholeVenue: false,
          cells: [],
        },
        at,
      );
    });
    expect(await tones(f.cfg, "2026-10-19")).toEqual({
      calendar: ["closed"],
      model: ["working_day"],
      closed: [true],
    });
    expect(await tones(f.cfg, "2026-10-26")).toEqual({
      calendar: ["blue"],
      model: ["working_day"],
      closed: [false],
    });
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
          { date, name: "Special Tuesday", closeWholeVenue, cells: [] },
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
    expect(await tones(f.cfg, "2026-10-20")).toEqual({
      calendar: ["blue"],
      model: ["working_day"],
      closed: [false],
    });
    expect(await tones(f.cfg, "2026-10-27")).toEqual({
      calendar: ["closed"],
      model: ["working_day"],
      closed: [true],
    });
  });

  it("a whole-venue named closure overrides a normally open weekday", async () => {
    const f = await fixture();
    expect(await tones(f.cfg, "2026-10-19")).toEqual({
      calendar: ["standard"],
      model: ["standard"],
      closed: [false],
    });
    await withTransaction(suite.db, (tx) =>
      saveSpecialDate(
        tx,
        f.cfg,
        null,
        { date: "2026-10-19", name: "Venue closed", closeWholeVenue: true, cells: [] },
        at,
      ),
    );
    expect(await tones(f.cfg, "2026-10-19")).toEqual({
      calendar: ["closed"],
      model: ["working_day"],
      closed: [true],
    });
  });

  it("ignores inactive departments and other venues, and closes when no active department is open", async () => {
    const f = await fixture();
    const other = await fixture();
    await withTransaction(suite.db, (tx) =>
      replaceMenuWeek(tx, other.cfg, other.department, other.week(2), at),
    );
    expect(await tones(f.cfg, "2026-10-20")).toEqual({
      calendar: ["closed"],
      model: ["closed"],
      closed: [true],
    });
    await suite.db
      .update(departments)
      .set({ active: false })
      .where(eq(departments.id, f.department));
    expect(await tones(f.cfg, "2026-10-19")).toEqual({
      calendar: ["closed"],
      model: ["closed"],
      closed: [true],
    });
  });
});
