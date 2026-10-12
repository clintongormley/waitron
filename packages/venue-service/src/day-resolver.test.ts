import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
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
import { seasons } from "./schema/seasons.js";
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

  it("closes a named day that closes the whole venue", async () => {
    const v = await autumnAndWinter();
    await namedDay(v, "2030-11-30", { closeWholeVenue: true });
    const days = await departmentDays(v, ["2030-11-30"]);
    expect(days.get("2030-11-30")?.ranges).toEqual([]);
  });

  it("serves a named day's own hours, and the season's week when it has none", async () => {
    const v = await autumnAndWinter();
    const own = await namedDay(v, "2030-11-30", { ownHours: true });
    await namedDay(v, "2030-12-01", { ownHours: true });
    await scoped((tx) =>
      saveSpecialDateMenus(
        tx,
        v.cfg,
        own,
        v.departmentId,
        [
          { periodId: v.lateBar, startsAt: "22:00", endsAt: "03:00" },
          { periodId: v.breakfast, startsAt: "10:00", endsAt: "12:00" },
        ],
        AT,
        0,
      ),
    );
    const days = await departmentDays(v, ["2030-11-30", "2030-12-01"]);
    expect(days.get("2030-11-30")?.ranges).toEqual([
      { periodId: v.breakfast, startsAt: "10:00", endsAt: "12:00" },
      { periodId: v.lateBar, startsAt: "22:00", endsAt: "03:00" },
    ]);
    expect(days.get("2030-12-01")?.ranges).toEqual([
      { periodId: v.breakfast, startsAt: "09:00", endsAt: "12:00" },
    ]);
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

  it("closes a named day whose own timetable has no slots", async () => {
    const v = await autumnAndWinter();
    const own = await namedDay(v, "2030-11-30", { ownHours: true });
    await scoped((tx) => saveSpecialDateMenus(tx, v.cfg, own, v.departmentId, [], AT, 0));
    const days = await departmentDays(v, ["2030-11-30"]);
    expect(days.get("2030-11-30")?.ranges).toEqual([]);
  });

  it("closes a named day with its own hours that also closes the whole venue", async () => {
    const v = await autumnAndWinter();
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
    await db.update(specialDates).set({ closeWholeVenue: true }).where(eq(specialDates.id, own));
    const days = await departmentDays(v, ["2030-11-30"]);
    expect(days.get("2030-11-30")?.ranges).toEqual([]);
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

  it("closes nothing on a named day that closes the whole venue", async () => {
    const v = await zones();
    await namedDay(v, "2030-11-30", { closeWholeVenue: true });
    const days = await zoneDays(v, [v.sala], ["2030-11-30"]);
    expect(days.get(v.sala)?.get("2030-11-30")).toEqual([]);
  });

  it("uses a named day's own closures, and none when it saved none", async () => {
    const v = await zones();
    const own = await namedDay(v, "2030-11-30", { ownHours: true });
    await namedDay(v, "2030-12-01", { ownHours: true });
    await scoped((tx) =>
      saveZoneClosedDate(
        tx,
        v.cfg,
        own,
        v.terraza,
        [{ startsAt: "18:00", endsAt: "20:00" }],
        0,
        AT,
      ),
    );
    const days = await zoneDays(v, undefined, ["2030-11-30", "2030-12-01"]);
    expect(days.get(v.terraza)?.get("2030-11-30")).toEqual([
      { startsAt: "18:00", endsAt: "20:00" },
    ]);
    expect(days.get(v.sala)?.get("2030-11-30")).toEqual([]);
    expect(days.get(v.sala)?.get("2030-12-01")).toEqual([]);
  });

  it("closes nothing on a named day with its own closures that also closes the whole venue", async () => {
    const v = await zones();
    const own = await namedDay(v, "2030-11-30", { ownHours: true });
    await scoped((tx) =>
      saveZoneClosedDate(tx, v.cfg, own, v.sala, [{ startsAt: "18:00", endsAt: "20:00" }], 0, AT),
    );
    await db.update(specialDates).set({ closeWholeVenue: true }).where(eq(specialDates.id, own));
    const days = await zoneDays(v, [v.sala], ["2030-11-30"]);
    expect(days.get(v.sala)?.get("2030-11-30")).toEqual([]);
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
