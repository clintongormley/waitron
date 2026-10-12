import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  buildMenuDocument,
  createCatalogue,
  menuDocumentHash,
  publishMenu,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  floorZones,
  locations,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId as brandLocationId, type BusinessDayClock } from "@waitron/shared";
import {
  readDayPlan,
  readServiceDayPlan,
  resolveDepartmentDays,
  resolveZoneClosedDays,
} from "./day-resolver.js";
import {
  replaceMenuWeek,
  resolveDepartmentService,
  saveMenuPeriod,
  saveSpecialDateMenus,
  updateMenuPeriod,
} from "./menu-timetable.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import {
  configureZone,
  createDepartment,
  menuState,
  readZoneClosingStates,
  type VenueScope,
} from "./operations.js";
import { specialDates } from "./schema/hours.js";
import {
  departmentDayRanges,
  departmentDays as departmentDayRows,
  seasons,
  specialDayDates,
  specialDays,
  zoneDayRanges,
  zoneDays as zoneDayRows,
} from "./schema/seasons.js";
import { ensureDefaultSeasons } from "./seasons.js";
import { closedZoneIdsAt, replaceZoneClosedWeek, saveZoneClosedDate } from "./zone-closed-times.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});
const scoped = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(db, fn);
const AT = new Date("2030-10-07T10:00:00Z");
const CLOCK: BusinessDayClock = {
  timeZone: "Europe/Madrid",
  dayCutover: "06:00",
  cutoverChanges: [],
};
const SATURDAY = 6;
const SUNDAY = 0;

async function venue(options: { oneSeason?: boolean } = {}) {
  const [location] = await db
    .insert(locations)
    .values({
      name: `Casa ${randomUUID()}`,
      invoiceLocales: ["es-ES"],
      operationDescription: "Hostelería",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
    })
    .returning({ id: locations.id });
  const cfg: VenueScope = { locationId: brandLocationId(location!.id) };
  const zones = await db
    .insert(floorZones)
    .values([
      { locationId: cfg.locationId, name: "Sala", displayOrder: 0 },
      { locationId: cfg.locationId, name: "Terraza", displayOrder: 1 },
    ])
    .returning({ id: floorZones.id });
  if (options.oneSeason === true)
    await db
      .insert(seasons)
      .values({ locationId: cfg.locationId, name: "All year", startsOn: "01-01" });
  return scoped(async (tx) => {
    const departmentId = (
      await createDepartment(tx, cfg, { name: "Restaurant", orderStart: "table" })
    ).id;
    for (const zone of zones) await configureZone(tx, cfg, { zoneId: zone.id, departmentId });
    const menus: Record<string, string> = {};
    const period = async (name: string) => {
      const menuId = (await createCatalogue(tx, { name })).id;
      menus[name] = menuId;
      const { document } = await buildMenuDocument(tx, menuId);
      await publishMenu(tx, menuId, menuDocumentHash(document), "person-1");
      return (await saveMenuPeriod(tx, cfg, departmentId, { name, menuId, staffMenuIds: [] }, 0))
        .id;
    };
    const ids = Object.fromEntries(
      (await ensureDefaultSeasons(tx, cfg)).map((season) => [season.name, season.id]),
    );
    return {
      cfg,
      departmentId,
      sala: zones[0]!.id,
      terraza: zones[1]!.id,
      dinner: await period("Dinner"),
      lateBar: await period("Late bar"),
      breakfast: await period("Breakfast"),
      menus,
      seasons: ids,
    };
  });
}
type Venue = Awaited<ReturnType<typeof venue>>;
type Slot = { periodId: string; startsAt: string; endsAt: string };
type Range = { startsAt: string; endsAt: string };

const menuWeek = (days: Record<number, Slot[]>) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: days[weekday] ?? [] }));
const closedWeek = (days: Record<number, Range[]>) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: days[weekday] ?? [] }));

const menuSeason = (v: Venue, seasonId: string, days: Record<number, Slot[]>) =>
  scoped((tx) => replaceMenuWeek(tx, v.cfg, v.departmentId, menuWeek(days), AT, 0, { seasonId }));
const zoneSeason = (v: Venue, zoneId: string, seasonId: string, days: Record<number, Range[]>) =>
  scoped((tx) => replaceZoneClosedWeek(tx, v.cfg, zoneId, closedWeek(days), 0, AT, { seasonId }));

async function namedDay(
  v: Venue,
  date: string,
  flags: { ownHours?: boolean; closeWholeVenue?: boolean },
): Promise<string> {
  const [row] = await db
    .insert(specialDates)
    .values({ locationId: v.cfg.locationId, date, name: `Day ${date}`, ...flags })
    .returning({ id: specialDates.id });
  return row!.id;
}

async function autumnAndWinter(): Promise<Venue> {
  const v = await venue();
  await menuSeason(v, v.seasons.Autumn!, {
    [SATURDAY]: [{ periodId: v.dinner, startsAt: "20:00", endsAt: "02:00" }],
  });
  await menuSeason(v, v.seasons.Winter!, {
    [SATURDAY]: [{ periodId: v.lateBar, startsAt: "20:00", endsAt: "02:00" }],
    [SUNDAY]: [{ periodId: v.breakfast, startsAt: "09:00", endsAt: "12:00" }],
  });
  return v;
}

const departmentDays = (v: Venue, days: readonly string[], clock = CLOCK) =>
  scoped((tx) => resolveDepartmentDays(tx, v.cfg, v.departmentId, days, clock));
const zoneDays = (v: Venue, zoneIds: readonly string[] | undefined, days: readonly string[]) =>
  scoped((tx) => resolveZoneClosedDays(tx, v.cfg, zoneIds, days, CLOCK));

describe("resolveDepartmentDays", () => {
  it("gives each business day the week of the season holding it, so yesterday keeps its own", async () => {
    const v = await autumnAndWinter();
    const days = await departmentDays(v, ["2030-11-30", "2030-12-01"]);
    expect(days.get("2030-11-30")).toEqual({
      businessDay: "2030-11-30",
      seasonId: v.seasons.Autumn,
      ranges: [{ periodId: v.dinner, startsAt: "20:00", endsAt: "02:00" }],
    });
    expect(days.get("2030-12-01")).toEqual({
      businessDay: "2030-12-01",
      seasonId: v.seasons.Winter,
      ranges: [{ periodId: v.breakfast, startsAt: "09:00", endsAt: "12:00" }],
    });
  });

  it("resolves Sunday 29 February 2032 to Winter's Sunday", async () => {
    const v = await autumnAndWinter();
    const days = await departmentDays(v, ["2032-02-29"]);
    expect(days.get("2032-02-29")).toEqual({
      businessDay: "2032-02-29",
      seasonId: v.seasons.Winter,
      ranges: [{ periodId: v.breakfast, startsAt: "09:00", endsAt: "12:00" }],
    });
  });

  it("resolves every date to a venue's only season", async () => {
    const v = await venue({ oneSeason: true });
    await menuSeason(v, v.seasons["All year"]!, {
      [SATURDAY]: [{ periodId: v.dinner, startsAt: "20:00", endsAt: "23:00" }],
    });
    const dates = ["2030-01-05", "2030-06-01", "2030-11-30", "2032-02-28"];
    const days = await departmentDays(v, dates);
    expect(dates.map((date) => days.get(date)?.seasonId)).toEqual(
      dates.map(() => v.seasons["All year"]),
    );
    expect(dates.map((date) => days.get(date)?.ranges)).toEqual(
      dates.map(() => [{ periodId: v.dinner, startsAt: "20:00", endsAt: "23:00" }]),
    );
  });

  it("answers no hours on a season whose week was never written", async () => {
    const v = await autumnAndWinter();
    const days = await departmentDays(v, ["2030-06-01"]);
    expect(days.get("2030-06-01")).toEqual({
      businessDay: "2030-06-01",
      seasonId: v.seasons.Summer,
      ranges: [],
    });
  });

  it("answers no hours and no season when the venue has no seasons", async () => {
    const [location] = await db
      .insert(locations)
      .values({
        name: `Casa ${randomUUID()}`,
        invoiceLocales: ["es-ES"],
        operationDescription: "Hostelería",
        timeZone: "Europe/Madrid",
      })
      .returning({ id: locations.id });
    const cfg: VenueScope = { locationId: brandLocationId(location!.id) };
    const departmentId = await scoped(
      async (tx) => (await createDepartment(tx, cfg, { name: "Bar", orderStart: "table" })).id,
    );
    const days = await scoped((tx) =>
      resolveDepartmentDays(tx, cfg, departmentId, ["2030-11-30"], CLOCK),
    );
    expect(days.get("2030-11-30")).toEqual({
      businessDay: "2030-11-30",
      seasonId: null,
      ranges: [],
    });
  });

  it("sorts each day from its own changeover", async () => {
    const v = await autumnAndWinter();
    await menuSeason(v, v.seasons.Winter!, {
      [SUNDAY]: [
        { periodId: v.lateBar, startsAt: "04:30", endsAt: "05:00" },
        { periodId: v.dinner, startsAt: "20:00", endsAt: "22:00" },
      ],
      [SATURDAY]: [
        { periodId: v.lateBar, startsAt: "04:30", endsAt: "05:00" },
        { periodId: v.dinner, startsAt: "20:00", endsAt: "22:00" },
      ],
    });
    const clock: BusinessDayClock = {
      ...CLOCK,
      cutoverChanges: [{ effectiveBusinessDay: "2030-12-08", dayCutover: "04:00" }],
    };
    const days = await departmentDays(v, ["2030-12-07", "2030-12-08"], clock);
    expect(days.get("2030-12-07")?.ranges.map((range) => range.startsAt)).toEqual([
      "20:00",
      "04:30",
    ]);
    expect(days.get("2030-12-08")?.ranges.map((range) => range.startsAt)).toEqual([
      "04:30",
      "20:00",
    ]);
  });

  it("answers an empty map for no days", async () => {
    const v = await autumnAndWinter();
    expect((await departmentDays(v, [])).size).toBe(0);
  });
});

describe("the till's service on a season boundary", () => {
  it("runs Autumn's Saturday Dinner at 00:15 on Sunday 1 December 2030 by the clock", async () => {
    const v = await autumnAndWinter();
    const restaurant = v.departmentId;
    const cfg = v.cfg;
    const at = new Date("2030-11-30T23:15:00Z"); // 00:15 in Madrid (UTC+1 in December)
    const service = await scoped((tx) => resolveDepartmentService(tx, cfg, restaurant, at));
    // Season by clock date gives Winter's Saturday: "Late bar".
    // Season and weekday by clock date give Winter's Sunday, closed until 09:00: null.
    expect({ at: "2030-12-01 00:15", period: service.periodName }).toEqual({
      at: "2030-12-01 00:15",
      period: "Dinner",
    });
  });

  it("yesterday's grace uses yesterday's season", async () => {
    const v = await venue();
    await scoped((tx) => updateMenuPeriod(tx, v.cfg, v.dinner, { endOffsetMinutes: 30 }, 0, AT));
    await scoped((tx) => updateMenuPeriod(tx, v.cfg, v.lateBar, { endOffsetMinutes: 30 }, 0, AT));
    await menuSeason(v, v.seasons.Autumn!, {
      [SATURDAY]: [{ periodId: v.dinner, startsAt: "20:00", endsAt: "05:45" }],
    });
    await menuSeason(v, v.seasons.Winter!, {
      [SATURDAY]: [{ periodId: v.lateBar, startsAt: "20:00", endsAt: "05:45" }],
    });
    const at = new Date("2030-12-01T05:05:00Z"); // 06:05 in Madrid, business day Sunday
    const service = await scoped((tx) => resolveDepartmentService(tx, v.cfg, v.departmentId, at));
    expect(service.sendableMenuIds).toContain(v.menus.Dinner);
    expect(service.sendableMenuIds).not.toContain(v.menus["Late bar"]);
  });

  it("an unreadable clock still opens every period's menus", async () => {
    const v = await autumnAndWinter();
    await db
      .update(locations)
      .set({ timeZone: "not/a-zone" })
      .where(eq(locations.id, v.cfg.locationId));
    const service = await scoped((tx) =>
      resolveDepartmentService(tx, v.cfg, v.departmentId, new Date("2030-11-30T23:15:00Z")),
    );
    expect(service.open).toBe(true);
    expect([...service.orderableMenuIds].sort()).toEqual(
      [v.menus.Dinner!, v.menus["Late bar"]!, v.menus.Breakfast!].sort(),
    );
  });

  it("an unreadable clock closes no zone", async () => {
    const v = await venue();
    await zoneSeason(v, v.sala, v.seasons.Autumn!, {
      [SATURDAY]: [{ startsAt: "00:00", endsAt: "05:00" }],
    });
    const at = new Date("2030-11-30T23:15:00Z");
    expect([...(await scoped((tx) => closedZoneIdsAt(tx, v.cfg, at)))]).toEqual([v.sala]);
    await db
      .update(locations)
      .set({ timeZone: "not/a-zone" })
      .where(eq(locations.id, v.cfg.locationId));
    expect([...(await scoped((tx) => closedZoneIdsAt(tx, v.cfg, at)))]).toEqual([]);
  });

  it("an unreadable clock answers every zone named with nothing to close", async () => {
    const v = await venue();
    await zoneSeason(v, v.sala, v.seasons.Autumn!, {
      [SATURDAY]: [{ startsAt: "00:00", endsAt: "05:00" }],
    });
    await db
      .update(locations)
      .set({ timeZone: "not/a-zone" })
      .where(eq(locations.id, v.cfg.locationId));
    const states = await scoped((tx) =>
      readZoneClosingStates(tx, v.cfg, [v.sala, v.terraza], new Date("2030-11-30T23:15:00Z")),
    );
    expect(states).toEqual(
      new Map([
        [v.sala, { closed: false, keepOpen: null }],
        [v.terraza, { closed: false, keepOpen: null }],
      ]),
    );
  });

  it("an unreadable clock keeps the till's menus and zone open", async () => {
    const v = await autumnAndWinter();
    await db
      .update(locations)
      .set({ timeZone: "not/a-zone" })
      .where(eq(locations.id, v.cfg.locationId));
    const state = await scoped((tx) =>
      menuState(tx, v.cfg, v.sala, new Date("2030-11-30T23:15:00Z")),
    );
    expect(state.service).toMatchObject({ open: true, zoneOpen: true, zoneKeepOpen: null });
  });
});

describe("a day plan shared between resolvers", () => {
  it("refuses a plan that does not cover a requested day", async () => {
    const v = await autumnAndWinter();
    const plan = await scoped((tx) => readDayPlan(tx, v.cfg, ["2030-11-30"]));
    await expect(
      scoped((tx) => resolveDepartmentDays(tx, v.cfg, v.departmentId, ["2030-12-01"], CLOCK, plan)),
    ).rejects.toThrow("the day plan does not cover 2030-12-01");
    await expect(
      scoped((tx) => resolveZoneClosedDays(tx, v.cfg, [v.sala], ["2030-12-01"], CLOCK, plan)),
    ).rejects.toThrow("the day plan does not cover 2030-12-01");
  });

  it("gives two departments and two zones each year-end day's own season", async () => {
    const TUESDAY = 2;
    const WEDNESDAY = 3;
    const v = await venue();
    await db.update(seasons).set({ startsOn: "01-01" }).where(eq(seasons.id, v.seasons.Winter!));
    await menuSeason(v, v.seasons.Autumn!, {
      [TUESDAY]: [{ periodId: v.dinner, startsAt: "20:00", endsAt: "02:00" }],
    });
    await menuSeason(v, v.seasons.Winter!, {
      [WEDNESDAY]: [{ periodId: v.breakfast, startsAt: "09:00", endsAt: "12:00" }],
    });
    const second = await scoped(async (tx) => {
      const id = (await createDepartment(tx, v.cfg, { name: "Second", orderStart: "table" })).id;
      const period = (
        await saveMenuPeriod(
          tx,
          v.cfg,
          id,
          { name: "Second dinner", menuId: v.menus.Dinner!, staffMenuIds: [] },
          0,
        )
      ).id;
      await replaceMenuWeek(
        tx,
        v.cfg,
        id,
        menuWeek({ [TUESDAY]: [{ periodId: period, startsAt: "21:00", endsAt: "03:00" }] }),
        AT,
        0,
        { seasonId: v.seasons.Autumn! },
      );
      return { id, period };
    });
    await zoneSeason(v, v.sala, v.seasons.Autumn!, {
      [TUESDAY]: [{ startsAt: "23:00", endsAt: "02:00" }],
    });
    await zoneSeason(v, v.terraza, v.seasons.Autumn!, {
      [TUESDAY]: [{ startsAt: "22:00", endsAt: "01:00" }],
    });
    // 00:15 on 1 January in Madrid still falls in business day 31 December.
    const prepared = await scoped((tx) =>
      readServiceDayPlan(tx, v.cfg, new Date("2030-12-31T23:15:00Z")),
    );
    expect([...prepared.plan!.seasonIdOn]).toEqual([
      ["2030-12-30", v.seasons.Autumn],
      ["2030-12-31", v.seasons.Autumn],
    ]);
    const days = ["2030-12-31", "2031-01-01"];
    const plan = await scoped((tx) => readDayPlan(tx, v.cfg, days));
    const first = await scoped((tx) =>
      resolveDepartmentDays(tx, v.cfg, v.departmentId, days, CLOCK, plan),
    );
    expect(first.get("2030-12-31")?.ranges).toEqual([
      { periodId: v.dinner, startsAt: "20:00", endsAt: "02:00" },
    ]);
    expect(first.get("2031-01-01")?.ranges).toEqual([
      { periodId: v.breakfast, startsAt: "09:00", endsAt: "12:00" },
    ]);
    const other = await scoped((tx) =>
      resolveDepartmentDays(tx, v.cfg, second.id, days, CLOCK, plan),
    );
    expect(other.get("2030-12-31")?.ranges).toEqual([
      { periodId: second.period, startsAt: "21:00", endsAt: "03:00" },
    ]);
    expect(other.get("2031-01-01")?.ranges).toEqual([]);
    const closed = await scoped((tx) =>
      resolveZoneClosedDays(tx, v.cfg, [v.sala, v.terraza], days, CLOCK, plan),
    );
    expect(closed.get(v.sala)?.get("2030-12-31")).toEqual([{ startsAt: "23:00", endsAt: "02:00" }]);
    expect(closed.get(v.terraza)?.get("2030-12-31")).toEqual([
      { startsAt: "22:00", endsAt: "01:00" },
    ]);
    expect(closed.get(v.sala)?.get("2031-01-01")).toEqual([]);
  });
});

describe("resolveZoneClosedDays", () => {
  async function zones(): Promise<Venue> {
    const v = await venue();
    await zoneSeason(v, v.sala, v.seasons.Autumn!, {
      [SATURDAY]: [{ startsAt: "15:00", endsAt: "19:00" }],
    });
    await zoneSeason(v, v.sala, v.seasons.Winter!, {
      [SATURDAY]: [{ startsAt: "12:00", endsAt: "14:00" }],
      [SUNDAY]: [
        { startsAt: "22:00", endsAt: "02:00" },
        { startsAt: "08:00", endsAt: "10:00" },
      ],
    });
    return v;
  }

  it("gives each zone each business day's closures from the season holding it", async () => {
    const v = await zones();
    const days = await zoneDays(v, [v.sala, v.terraza], ["2030-11-30", "2030-12-01"]);
    expect(days.get(v.sala)).toEqual(
      new Map([
        ["2030-11-30", [{ startsAt: "15:00", endsAt: "19:00" }]],
        [
          "2030-12-01",
          [
            { startsAt: "08:00", endsAt: "10:00" },
            { startsAt: "22:00", endsAt: "02:00" },
          ],
        ],
      ]),
    );
    expect(days.get(v.terraza)).toEqual(
      new Map([
        ["2030-11-30", []],
        ["2030-12-01", []],
      ]),
    );
  });

  it("reads every zone when none are named", async () => {
    const v = await zones();
    const days = await zoneDays(v, undefined, ["2030-11-30"]);
    expect(days.get(v.sala)?.get("2030-11-30")).toEqual([{ startsAt: "15:00", endsAt: "19:00" }]);
    expect(days.get(v.terraza)?.get("2030-11-30")).toEqual([]);
  });

  it("answers an empty map for no days", async () => {
    const v = await zones();
    expect((await zoneDays(v, undefined, [])).size).toBe(0);
  });

  it("answers an empty map for an empty zone list", async () => {
    const v = await zones();
    expect((await zoneDays(v, [], ["2030-11-30"])).size).toBe(0);
  });
});

describe("named days on the sale path", () => {
  it("leaves a date with a named day on its season's week", async () => {
    const v = await autumnAndWinter();
    await zoneSeason(v, v.sala, v.seasons.Autumn!, {
      [SATURDAY]: [{ startsAt: "15:00", endsAt: "19:00" }],
    });
    await zoneSeason(v, v.sala, v.seasons.Winter!, {
      [SUNDAY]: [{ startsAt: "08:00", endsAt: "10:00" }],
    });
    const own = await namedDay(v, "2030-11-30", { ownHours: true });
    await scoped((tx) =>
      saveSpecialDateMenus(
        tx,
        v.cfg,
        own,
        v.departmentId,
        [{ periodId: v.lateBar, startsAt: "22:00", endsAt: "03:00" }],
        AT,
        0,
      ),
    );
    await scoped((tx) =>
      saveZoneClosedDate(tx, v.cfg, own, v.sala, [{ startsAt: "18:00", endsAt: "20:00" }], 0, AT),
    );
    await namedDay(v, "2030-12-01", { closeWholeVenue: true });
    const days = await departmentDays(v, ["2030-11-30", "2030-12-01"]);
    expect(days.get("2030-11-30")?.ranges).toEqual([
      { periodId: v.dinner, startsAt: "20:00", endsAt: "02:00" },
    ]);
    expect(days.get("2030-12-01")?.ranges).toEqual([
      { periodId: v.breakfast, startsAt: "09:00", endsAt: "12:00" },
    ]);
    const zones = await zoneDays(v, [v.sala], ["2030-11-30", "2030-12-01"]);
    expect(zones.get(v.sala)).toEqual(
      new Map([
        ["2030-11-30", [{ startsAt: "15:00", endsAt: "19:00" }]],
        ["2030-12-01", [{ startsAt: "08:00", endsAt: "10:00" }]],
      ]),
    );
  });
});

type PaintSlot = { periodId: string | null; startsAt: string; endsAt: string };
type ZoneSlot = { kind: "closed" | "open"; startsAt: string; endsAt: string };

async function specialDay(
  v: Venue,
  date: string,
  options: {
    repeats?: boolean;
    closedAllDay?: boolean;
    paint?: Record<string, PaintSlot[]>;
    zonePaint?: Record<string, ZoneSlot[]>;
  } = {},
): Promise<string> {
  const [day] = await db
    .insert(specialDays)
    .values({
      locationId: v.cfg.locationId,
      name: `Special ${date}`,
      repeatsYearly: options.repeats,
    })
    .returning({ id: specialDays.id });
  const [dated] = await db
    .insert(specialDayDates)
    .values({
      specialDayId: day!.id,
      locationId: v.cfg.locationId,
      date,
      closedAllDay: options.closedAllDay,
    })
    .returning({ id: specialDayDates.id });
  for (const [departmentId, ranges] of Object.entries(options.paint ?? {})) {
    const [row] = await db
      .insert(departmentDayRows)
      .values({ departmentId, specialDayDateId: dated!.id })
      .returning({ id: departmentDayRows.id });
    if (ranges.length > 0)
      await db
        .insert(departmentDayRanges)
        .values(ranges.map((range) => ({ ...range, dayId: row!.id, departmentId })));
  }
  for (const [zoneId, ranges] of Object.entries(options.zonePaint ?? {})) {
    const [row] = await db
      .insert(zoneDayRows)
      .values({ zoneId, specialDayDateId: dated!.id })
      .returning({ id: zoneDayRows.id });
    if (ranges.length > 0)
      await db.insert(zoneDayRanges).values(ranges.map((range) => ({ ...range, dayId: row!.id })));
  }
  return day!.id;
}

describe("special-day paint over the season", () => {
  const FRIDAY = 5;
  const WEDNESDAY = 3;

  it("runs a special night's Dinner past midnight on its own night only", async () => {
    const v = await venue();
    await menuSeason(v, v.seasons.Winter!, {
      [FRIDAY]: [{ periodId: v.dinner, startsAt: "20:00", endsAt: "23:30" }],
      [SATURDAY]: [{ periodId: v.dinner, startsAt: "20:00", endsAt: "23:30" }],
    });
    await specialDay(v, "2030-12-13", {
      paint: { [v.departmentId]: [{ periodId: v.dinner, startsAt: "20:00", endsAt: "02:00" }] },
    });
    const service = (at: string) =>
      scoped((tx) => resolveDepartmentService(tx, v.cfg, v.departmentId, new Date(at)));
    // 01:00 in Madrid on Saturday 14 December, business day Friday 13th.
    const first = await service("2030-12-14T00:00:00Z");
    expect({ open: first.open, period: first.periodName }).toEqual({
      open: true,
      period: "Dinner",
    });
    // 01:00 in Madrid on Sunday 15 December, business day Saturday 14th.
    const second = await service("2030-12-15T00:00:00Z");
    expect({ open: second.open, period: second.periodName }).toEqual({ open: false, period: null });
    const days = await departmentDays(v, ["2030-12-13", "2030-12-14"]);
    expect(days.get("2030-12-13")).toEqual({
      businessDay: "2030-12-13",
      seasonId: v.seasons.Winter,
      ranges: [{ periodId: v.dinner, startsAt: "20:00", endsAt: "02:00" }],
    });
    expect(days.get("2030-12-14")?.ranges).toEqual([
      { periodId: v.dinner, startsAt: "20:00", endsAt: "23:30" },
    ]);
  });

  it("closes every department and ignores zone paint on a date with the Closed tick", async () => {
    const v = await venue();
    await menuSeason(v, v.seasons.Winter!, {
      [FRIDAY]: [{ periodId: v.dinner, startsAt: "20:00", endsAt: "23:30" }],
    });
    await zoneSeason(v, v.sala, v.seasons.Winter!, {
      [FRIDAY]: [{ startsAt: "22:00", endsAt: "23:00" }],
    });
    await specialDay(v, "2030-12-13", {
      closedAllDay: true,
      paint: { [v.departmentId]: [{ periodId: v.dinner, startsAt: "12:00", endsAt: "16:00" }] },
      zonePaint: { [v.terraza]: [{ kind: "closed", startsAt: "12:00", endsAt: "13:00" }] },
    });
    const later = await scoped(async (tx) => {
      const id = (await createDepartment(tx, v.cfg, { name: "Later", orderStart: "table" })).id;
      const period = (
        await saveMenuPeriod(
          tx,
          v.cfg,
          id,
          { name: "Later dinner", menuId: v.menus.Dinner!, staffMenuIds: [] },
          0,
        )
      ).id;
      await replaceMenuWeek(
        tx,
        v.cfg,
        id,
        menuWeek({ [FRIDAY]: [{ periodId: period, startsAt: "19:00", endsAt: "23:00" }] }),
        AT,
        0,
        { seasonId: v.seasons.Winter! },
      );
      return id;
    });
    expect((await departmentDays(v, ["2030-12-13"])).get("2030-12-13")?.ranges).toEqual([]);
    const laterDays = await scoped((tx) =>
      resolveDepartmentDays(tx, v.cfg, later, ["2030-12-13", "2030-12-20"], CLOCK),
    );
    expect(laterDays.get("2030-12-13")?.ranges).toEqual([]);
    expect(laterDays.get("2030-12-20")?.ranges).toHaveLength(1);
    const zones = await zoneDays(v, [v.sala, v.terraza], ["2030-12-13"]);
    expect(zones.get(v.sala)?.get("2030-12-13")).toEqual([]);
    expect(zones.get(v.terraza)?.get("2030-12-13")).toEqual([]);
  });

  it("repeats a yearly special day from its first year on, never before", async () => {
    const v = await venue();
    await specialDay(v, "2030-12-24", {
      repeats: true,
      paint: { [v.departmentId]: [{ periodId: v.dinner, startsAt: "19:00", endsAt: "22:00" }] },
    });
    const days = await departmentDays(v, ["2029-12-24", "2030-12-24", "2031-12-24"]);
    expect(days.get("2029-12-24")?.ranges).toEqual([]);
    expect(days.get("2030-12-24")?.ranges).toEqual([
      { periodId: v.dinner, startsAt: "19:00", endsAt: "22:00" },
    ]);
    expect(days.get("2031-12-24")?.ranges).toEqual([
      { periodId: v.dinner, startsAt: "19:00", endsAt: "22:00" },
    ]);
  });

  it("repeats a 29 February special day in leap years only", async () => {
    const v = await venue();
    await specialDay(v, "2028-02-29", {
      repeats: true,
      paint: { [v.departmentId]: [{ periodId: v.dinner, startsAt: "19:00", endsAt: "22:00" }] },
    });
    const days = await departmentDays(v, ["2031-02-28", "2031-03-01", "2032-02-29"]);
    expect(days.get("2031-02-28")?.ranges).toEqual([]);
    expect(days.get("2031-03-01")?.ranges).toEqual([]);
    expect(days.get("2032-02-29")?.ranges).toEqual([
      { periodId: v.dinner, startsAt: "19:00", endsAt: "22:00" },
    ]);
  });

  it("opens a zone its season closes, and still sells nothing where the department is closed", async () => {
    const v = await venue();
    await menuSeason(v, v.seasons.Winter!, {
      [FRIDAY]: [{ periodId: v.dinner, startsAt: "20:00", endsAt: "22:00" }],
    });
    await zoneSeason(v, v.terraza, v.seasons.Winter!, {
      [FRIDAY]: [{ startsAt: "22:00", endsAt: "06:00" }],
    });
    await specialDay(v, "2030-12-13", {
      zonePaint: { [v.terraza]: [{ kind: "open", startsAt: "22:00", endsAt: "23:30" }] },
    });
    const at = new Date("2030-12-13T21:30:00Z"); // 22:30 in Madrid
    expect([...(await scoped((tx) => closedZoneIdsAt(tx, v.cfg, at)))]).toEqual([]);
    const zones = await zoneDays(v, [v.terraza], ["2030-12-13"]);
    expect(zones.get(v.terraza)?.get("2030-12-13")).toEqual([
      { startsAt: "23:30", endsAt: "06:00" },
    ]);
    const service = await scoped((tx) => resolveDepartmentService(tx, v.cfg, v.departmentId, at));
    expect(service.open).toBe(false);
  });

  it("follows the season now holding a special date after a season start moves", async () => {
    const v = await venue();
    await menuSeason(v, v.seasons.Autumn!, {
      [WEDNESDAY]: [{ periodId: v.dinner, startsAt: "20:00", endsAt: "23:00" }],
    });
    await menuSeason(v, v.seasons.Winter!, {
      [WEDNESDAY]: [{ periodId: v.lateBar, startsAt: "21:00", endsAt: "23:30" }],
    });
    await specialDay(v, "2030-11-20", {
      paint: { [v.departmentId]: [{ periodId: v.breakfast, startsAt: "09:00", endsAt: "10:00" }] },
    });
    expect((await departmentDays(v, ["2030-11-20"])).get("2030-11-20")).toEqual({
      businessDay: "2030-11-20",
      seasonId: v.seasons.Autumn,
      ranges: [
        { periodId: v.breakfast, startsAt: "09:00", endsAt: "10:00" },
        { periodId: v.dinner, startsAt: "20:00", endsAt: "23:00" },
      ],
    });
    await db.update(seasons).set({ startsOn: "11-15" }).where(eq(seasons.id, v.seasons.Winter!));
    expect((await departmentDays(v, ["2030-11-20"])).get("2030-11-20")).toEqual({
      businessDay: "2030-11-20",
      seasonId: v.seasons.Winter,
      ranges: [
        { periodId: v.breakfast, startsAt: "09:00", endsAt: "10:00" },
        { periodId: v.lateBar, startsAt: "21:00", endsAt: "23:30" },
      ],
    });
  });

  it("lays a special day's Closed paint over the department's season, leaving zones their week", async () => {
    const v = await venue();
    await menuSeason(v, v.seasons.Winter!, {
      [FRIDAY]: [{ periodId: v.dinner, startsAt: "20:00", endsAt: "23:30" }],
    });
    await zoneSeason(v, v.sala, v.seasons.Winter!, {
      [FRIDAY]: [{ startsAt: "22:00", endsAt: "23:00" }],
    });
    await specialDay(v, "2030-12-13", {
      paint: { [v.departmentId]: [{ periodId: null, startsAt: "22:00", endsAt: "23:30" }] },
    });
    expect((await departmentDays(v, ["2030-12-13"])).get("2030-12-13")?.ranges).toEqual([
      { periodId: v.dinner, startsAt: "20:00", endsAt: "22:00" },
    ]);
    expect((await zoneDays(v, [v.sala], ["2030-12-13"])).get(v.sala)?.get("2030-12-13")).toEqual([
      { startsAt: "22:00", endsAt: "23:00" },
    ]);
  });

  it("reads special-day dates and their paint once, however many zones and days a call covers", async () => {
    const v = await venue();
    const third = await scoped(async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: v.cfg.locationId, name: "Barra", displayOrder: 2 })
        .returning({ id: floorZones.id });
      await configureZone(tx, v.cfg, { zoneId: zone!.id, departmentId: v.departmentId });
      return zone!.id;
    });
    const closedEvening = [{ kind: "closed" as const, startsAt: "22:00", endsAt: "23:00" }];
    const dinner = [{ periodId: v.dinner, startsAt: "20:00", endsAt: "23:00" }];
    for (const date of ["2030-12-13", "2030-12-14"])
      await specialDay(v, date, {
        paint: { [v.departmentId]: dinner },
        zonePaint: { [v.sala]: closedEvening, [v.terraza]: closedEvening, [third]: closedEvening },
      });
    const at = new Date("2030-12-14T21:30:00Z"); // 22:30 in Madrid, business day 14 December
    const statements = (call: (tx: Transaction) => Promise<void>) =>
      scoped(async (tx) => {
        const session = (
          tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
        ).session;
        const spy = vi.spyOn(session, "prepareQuery");
        try {
          await call(tx);
          return spy.mock.calls.map(([query]) => (query as unknown as { sql: string }).sql);
        } finally {
          spy.mockRestore();
        }
      });
    const zones = (zoneIds: string[]) =>
      statements(async (tx) => {
        expect([...(await closedZoneIdsAt(tx, v.cfg, at, zoneIds))].sort()).toEqual(
          [...zoneIds].sort(),
        );
      });
    const days = (businessDays: string[]) =>
      statements(async (tx) => {
        const resolved = await resolveDepartmentDays(
          tx,
          v.cfg,
          v.departmentId,
          businessDays,
          CLOCK,
        );
        expect(businessDays.map((day) => resolved.get(day)?.ranges)).toEqual(
          businessDays.map(() => dinner),
        );
      });
    const one = await zones([v.sala]);
    const three = await zones([v.sala, v.terraza, third]);
    const oneDay = await days(["2030-12-13"]);
    const twoDays = await days(["2030-12-13", "2030-12-14"]);
    expect(twoDays).toHaveLength(oneDay.length);
    for (const texts of [one, three, oneDay, twoDays]) {
      expect(texts.filter((text) => text.includes(`from "special_day_dates"`))).toHaveLength(1);
      // Department and zone paint come back in one statement.
      expect(texts.filter((text) => text.includes(`"special_day_date_id" in`))).toHaveLength(1);
    }
    expect(three).toHaveLength(one.length);
  });

  it("refuses a shared plan that does not cover a requested day's special days", async () => {
    const v = await venue();
    const plan = await scoped((tx) => readDayPlan(tx, v.cfg, ["2030-12-13"]));
    const partial = { ...plan, special: new Map() };
    await expect(
      scoped((tx) =>
        resolveDepartmentDays(tx, v.cfg, v.departmentId, ["2030-12-13"], CLOCK, partial),
      ),
    ).rejects.toThrow("the day plan does not cover 2030-12-13");
  });
});
