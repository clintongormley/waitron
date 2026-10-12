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
import { readSeasons } from "./seasons.js";
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
        },
      ])
      .returning();
    const [menu] = await tx.insert(catalogues).values({ name: randomUUID() }).returning();
    const period = await saveMenuPeriod(
      tx,
      cfg,
      department!.id,
      {
        name: "Late",
        menuId: menu!.id,
        staffMenuIds: [],
      },
      0,
    );
    const week = (weekday: number) =>
      [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        weekday: day,
        slots: day === weekday ? [{ periodId: period.id, startsAt: "22:00", endsAt: "03:00" }] : [],
      }));
    await replaceMenuWeek(tx, cfg, department!.id, week(1), at, 0);
    const inactivePeriod = await saveMenuPeriod(
      tx,
      cfg,
      inactive!.id,
      {
        name: "Terrace",
        menuId: menu!.id,
        staffMenuIds: [],
      },
      0,
    );
    await replaceMenuWeek(
      tx,
      cfg,
      inactive!.id,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [{ periodId: inactivePeriod.id, startsAt: "04:30", endsAt: "04:30" }],
      })),
      at,
      0,
    );
    await tx.update(departments).set({ active: false }).where(eq(departments.id, inactive!.id));
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

  it("reads each date's own season: Winter's Monday Lunch opens 2 December, Autumn's empty Monday closes 25 November", async () => {
    const f = await fixture();
    await withTransaction(suite.db, async (tx) => {
      const seasons = await readSeasons(tx, f.cfg);
      const seasonId = (name: string) => seasons.find((season) => season.name === name)!.id;
      const lunch = await saveMenuPeriod(
        tx,
        f.cfg,
        f.department,
        { name: "Lunch", menuId: (await tx.select().from(catalogues))[0]!.id, staffMenuIds: [] },
        0,
      );
      const monday = (slots: readonly { periodId: string; startsAt: string; endsAt: string }[]) =>
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: weekday === 1 ? slots : [] }));
      await replaceMenuWeek(
        tx,
        f.cfg,
        f.department,
        monday([{ periodId: lunch.id, startsAt: "12:00", endsAt: "15:00" }]),
        at,
        0,
        { seasonId: seasonId("Winter") },
      );
      await replaceMenuWeek(tx, f.cfg, f.department, monday([]), at, 0, {
        seasonId: seasonId("Autumn"),
      });
    });
    const calendar = await withTransaction(suite.db, (tx) =>
      readCalendarDays(tx, f.cfg, "2030-11-25", "2030-12-02"),
    );
    expect(calendar.map((day) => [day.date, day.tone])).toEqual([
      ["2030-11-25", "closed"],
      ["2030-11-26", "closed"],
      ["2030-11-27", "closed"],
      ["2030-11-28", "closed"],
      ["2030-11-29", "closed"],
      ["2030-11-30", "closed"],
      ["2030-12-01", "closed"],
      ["2030-12-02", "standard"],
    ]);
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
        undefined,
        0,
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
        undefined,
        0,
      );
      await tx.update(specialDates).set({ ownHours: true }).where(eq(specialDates.id, special.id));
      await saveSpecialDateMenus(tx, f.cfg, special.id, f.department, [], at, 0);
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
        undefined,
        0,
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
          undefined,
          0,
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
            0,
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
        undefined,
        0,
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
      replaceMenuWeek(tx, other.cfg, other.department, other.week(2), at, 0),
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
