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
import { readLocationClock } from "@waitron/reporting";
import {
  locationId as brandLocationId,
  type CalendarColour,
  type LocationId,
} from "@waitron/shared";
import { resolveDepartmentDays } from "./day-resolver.js";
import { saveMenuPeriod } from "./menu-timetable.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { configureZone, createDepartment, type VenueScope } from "./operations.js";
import { menuPeriods } from "./schema/menus.js";
import { departmentDays, seasons, zoneDays } from "./schema/seasons.js";
import { parseSeasonStart, type SeasonChange, type SeasonEntry } from "./season-rules.js";
import {
  readDepartmentSeasonWeeks,
  readZoneSeasonWeeks,
  writeDepartmentSeasonWeeks,
  writeZoneSeasonWeeks,
} from "./season-weeks.js";
import {
  ensureDefaultSeasons,
  readSeasons,
  saveSeasons,
  seasonDeleteImpact,
  temporaryStart,
} from "./seasons.js";
import { saveSpecialDay } from "./special-days.js";
import type { ServiceRange } from "./service-day.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
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

  it("gives a new location Spring green, Summer amber, Autumn orange and Winter blue", async () => {
    const locationId = await newLocation("Coloured seasons");
    await withTransaction(db, (tx) => ensureDefaultSeasons(tx, { locationId }));
    const stored = await withTransaction(db, (tx) => readSeasons(tx, { locationId }));
    expect(stored.map(({ name, colour }) => [name, colour])).toEqual([
      ["Spring", "green"],
      ["Summer", "amber"],
      ["Autumn", "orange"],
      ["Winter", "blue"],
    ]);
  });

  it("leaves a location that already has a season alone", async () => {
    const locationId = await newLocation("One season");
    const [own] = await db
      .insert(seasons)
      .values({ locationId, name: "All year", startsOn: "01-01" })
      .returning({ id: seasons.id });
    const result = await withTransaction(db, (tx) => ensureDefaultSeasons(tx, { locationId }));
    expect(result).toEqual([{ id: own!.id, name: "All year", startsOn: "01-01", colour: "grey" }]);
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

const scoped = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(db, fn);
const AT = new Date("2030-10-07T10:00:00Z");
const EMPTY_WEEK = (): ServiceRange[][] => Array.from({ length: 7 }, () => []);
const SATURDAY = 6;
const SUNDAY = 0;

/** Autumn (09-01), Late autumn (11-01) and Winter (12-01), whose weeks border each other cleanly:
 *  Autumn's Saturday Dinner sends until 06:15 (+30), but Autumn's and Late autumn's Sundays hold
 *  nothing near the 06:00 changeover, and Winter's Saturday has no late Dinner before its own
 *  Sunday Breakfast at 06:00. */
async function autumnVenue() {
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
  const [zone] = await db
    .insert(floorZones)
    .values({ locationId: cfg.locationId, name: "Terraza", displayOrder: 0 })
    .returning({ id: floorZones.id });
  const stored = await db
    .insert(seasons)
    .values([
      { locationId: cfg.locationId, name: "Autumn", startsOn: "09-01" },
      { locationId: cfg.locationId, name: "Late autumn", startsOn: "11-01" },
      { locationId: cfg.locationId, name: "Winter", startsOn: "12-01" },
    ])
    .returning({ id: seasons.id, name: seasons.name });
  const seasonId = (name: string) => stored.find((season) => season.name === name)!.id;
  return scoped(async (tx) => {
    const restaurant = (
      await createDepartment(tx, cfg, { name: "Restaurant", orderStart: "table" })
    ).id;
    const bar = (await createDepartment(tx, cfg, { name: "Bar", orderStart: "counter" })).id;
    await configureZone(tx, cfg, { zoneId: zone!.id, departmentId: restaurant });
    const period = async (name: string) => {
      const menuId = (await createCatalogue(tx, { name })).id;
      const { document } = await buildMenuDocument(tx, menuId);
      await publishMenu(tx, menuId, menuDocumentHash(document), "person-1");
      return (await saveMenuPeriod(tx, cfg, restaurant, { name, menuId, staffMenuIds: [] }, 0)).id;
    };
    const breakfast = await period("Breakfast");
    const dinner = await period("Dinner");
    await tx.update(menuPeriods).set({ endOffsetMinutes: 30 }).where(eq(menuPeriods.id, dinner));
    const autumnWeek = EMPTY_WEEK();
    autumnWeek[SATURDAY] = [{ periodId: dinner, startsAt: "20:00", endsAt: "05:45" }];
    autumnWeek[3] = [{ periodId: breakfast, startsAt: "08:00", endsAt: "11:00" }];
    const winterWeek = EMPTY_WEEK();
    winterWeek[SUNDAY] = [{ periodId: breakfast, startsAt: "06:00", endsAt: "11:00" }];
    winterWeek[SATURDAY] = [{ periodId: dinner, startsAt: "20:00", endsAt: "23:00" }];
    const ids = {
      autumn: seasonId("Autumn"),
      lateAutumn: seasonId("Late autumn"),
      winter: seasonId("Winter"),
    };
    await writeDepartmentSeasonWeeks(tx, restaurant, [ids.autumn], autumnWeek);
    await writeDepartmentSeasonWeeks(tx, restaurant, [ids.lateAutumn], EMPTY_WEEK());
    await writeDepartmentSeasonWeeks(tx, restaurant, [ids.winter], winterWeek);
    await writeDepartmentSeasonWeeks(tx, bar, [ids.autumn], EMPTY_WEEK());
    const zoneWeek = Array.from({ length: 7 }, () => [] as { startsAt: string; endsAt: string }[]);
    zoneWeek[2] = [{ startsAt: "15:00", endsAt: "18:00" }];
    await writeZoneSeasonWeeks(tx, zone!.id, [ids.autumn, ids.winter], zoneWeek);
    return {
      cfg,
      restaurant,
      bar,
      terraza: zone!.id,
      breakfast,
      dinner,
      ...ids,
      autumnWeek,
      winterWeek,
      zoneWeek,
    };
  });
}
type AutumnVenue = Awaited<ReturnType<typeof autumnVenue>>;

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return {
      code: (error as { code?: string }).code,
      params: (error as { params?: object }).params,
    };
  }
  throw new Error("expected a refusal");
};
const seasonsOf = (v: AutumnVenue) => scoped((tx) => readSeasons(tx, v.cfg)).then(shape);
const seasonOnDay = (v: AutumnVenue, day: string) =>
  scoped(async (tx) => {
    const clock = await readLocationClock(tx, v.cfg.locationId);
    const days = await resolveDepartmentDays(tx, v.cfg, v.restaurant, [day], clock);
    return days.get(day)?.seasonId;
  });
const restaurantWeek = (v: AutumnVenue, seasonId: string) =>
  scoped((tx) => readDepartmentSeasonWeeks(tx, v.cfg, [v.restaurant])).then((weeks) =>
    weeks.get(v.restaurant)?.get(seasonId),
  );
const terrazaWeek = (v: AutumnVenue, seasonId: string) =>
  scoped((tx) => readZoneSeasonWeeks(tx, v.cfg, [v.terraza])).then((weeks) =>
    weeks.get(v.terraza)?.get(seasonId),
  );
const THREE = [
  { name: "Autumn", startsOn: "09-01" },
  { name: "Late autumn", startsOn: "11-01" },
  { name: "Winter", startsOn: "12-01" },
];

describe("seasonDeleteImpact", () => {
  it("lists the departments that painted the season, not ones holding only empty days", async () => {
    const v = await autumnVenue();
    const impact = (id: string) => scoped((tx) => seasonDeleteImpact(tx, v.cfg, id));
    expect(await impact(v.autumn)).toEqual({
      departments: [{ id: v.restaurant, name: "Restaurant" }],
    });
    expect(await impact(v.lateAutumn)).toEqual({ departments: [] });
    expect(await refusal(impact(randomUUID()))).toMatchObject({ code: "season.not_found" });
  });
});

describe("saveSeasons", () => {
  const change = (v: { cfg: VenueScope }, sent: Partial<SeasonChange>, revision = 0) =>
    scoped((tx) => saveSeasons(tx, v.cfg, { save: [], delete: [], ...sent }, AT, revision));
  const entry = (
    id: string | undefined,
    name: string,
    startsOn: string,
    colour: CalendarColour = "grey",
  ): SeasonEntry =>
    id === undefined ? { name, startsOn, colour } : { id, name, startsOn, colour };
  const everyWeek = (v: AutumnVenue) =>
    scoped(async (tx) => ({
      departments: await readDepartmentSeasonWeeks(tx, v.cfg),
      zones: await readZoneSeasonWeeks(tx, v.cfg),
    }));

  it.each(["02-29", "13-01", "04-31", "1-1"])("refuses the start %s", async (startsOn) => {
    const v = await autumnVenue();
    expect(await refusal(change(v, { save: [entry(v.winter, "Winter", startsOn)] }))).toEqual({
      code: "season.invalid",
      params: { field: "save.0.startsOn" },
    });
    expect(await seasonsOf(v)).toEqual(THREE);
  });

  it("refuses a start another season holds", async () => {
    const v = await autumnVenue();
    expect(await refusal(change(v, { save: [entry(v.winter, "Winter", "11-01")] }))).toEqual({
      code: "season.invalid",
      params: { field: "save.0.startsOn", reason: "taken" },
    });
  });

  it("refuses a name another season holds, as trimmed, and an empty name", async () => {
    const v = await autumnVenue();
    expect(await refusal(change(v, { save: [entry(v.lateAutumn, "  Winter ", "11-01")] }))).toEqual(
      { code: "season.invalid", params: { field: "save.0.name", reason: "taken" } },
    );
    expect(await refusal(change(v, { save: [entry(v.lateAutumn, "   ", "11-01")] }))).toEqual({
      code: "season.invalid",
      params: { field: "save.0.name" },
    });
    expect(
      await refusal(change(v, { save: [entry(v.lateAutumn, null as unknown as string, "11-01")] })),
    ).toEqual({ code: "season.invalid", params: { field: "save.0.name" } });
    expect(await seasonsOf(v)).toEqual(THREE);
  });

  it("renames a season, trimming the name, and keeps its own start", async () => {
    const v = await autumnVenue();
    const saved = await change(v, { save: [entry(v.lateAutumn, " Fall ", "11-01")] });
    expect(saved).toContainEqual({
      id: v.lateAutumn,
      name: "Fall",
      startsOn: "11-01",
      colour: "grey",
    });
  });

  it("moves Winter to 11-15, so 20 November resolves to Winter on the next read", async () => {
    const v = await autumnVenue();
    expect(await seasonOnDay(v, "2030-11-20")).toBe(v.lateAutumn);
    const saved = await change(v, { save: [entry(v.winter, "Winter", "11-15")] });
    expect(saved).toContainEqual({
      id: v.winter,
      name: "Winter",
      startsOn: "11-15",
      colour: "grey",
    });
    expect(await seasonOnDay(v, "2030-11-20")).toBe(v.winter);
    expect(await restaurantWeek(v, v.winter)).toEqual(v.winterWeek);
  });

  it("refuses a move whose new boundary clashes with a special day's sending, changing nothing", async () => {
    const v = await autumnVenue();
    // Saturday 9 November, in Late autumn, sends Dinner until 06:15; Late autumn's Sunday is empty.
    const eve = await scoped((tx) =>
      saveSpecialDay(
        tx,
        v.cfg,
        null,
        {
          name: "Gala",
          repeatsYearly: false,
          dates: [{ date: "2030-11-09", closedAllDay: false }],
          paint: [
            {
              departmentId: v.restaurant,
              date: "2030-11-09",
              ranges: [{ periodId: v.dinner, startsAt: "20:00", endsAt: "05:45" }],
            },
          ],
        },
        AT,
        0,
      ),
    );
    expect(await refusal(change(v, { save: [entry(v.winter, "Winter", "11-10")] }))).toEqual({
      code: "season.invalid",
      params: {
        field: "seasons",
        reason: "end_offset",
        date: "2030-11-09",
        periodId: v.dinner,
        departmentId: v.restaurant,
        specialDayId: eve.id,
      },
    });
    expect(await seasonsOf(v)).toEqual(THREE);
  });

  it("refuses a move under a stale clock revision before anything changes", async () => {
    const v = await autumnVenue();
    expect(await refusal(change(v, { save: [entry(v.winter, "Winter", "11-15")] }, 1))).toEqual({
      code: "hours.clock_changed",
      params: {},
    });
    expect(await seasonsOf(v)).toEqual(THREE);
  });

  it("renames and recolours under a stale clock revision, while a move under the same revision is refused", async () => {
    const v = await autumnVenue();
    const renamed = await change(v, { save: [entry(v.lateAutumn, "Fall", "11-01", "teal")] }, 1);
    expect(renamed).toContainEqual({
      id: v.lateAutumn,
      name: "Fall",
      startsOn: "11-01",
      colour: "teal",
    });
    expect(
      await refusal(change(v, { save: [entry(v.lateAutumn, "Fall", "11-05", "teal")] }, 1)),
    ).toEqual({ code: "hours.clock_changed", params: {} });
    expect(await seasonsOf(v)).toEqual([
      { name: "Autumn", startsOn: "09-01" },
      { name: "Fall", startsOn: "11-01" },
      { name: "Winter", startsOn: "12-01" },
    ]);
  });

  it("refuses another venue's season in save or in delete", async () => {
    const v = await autumnVenue();
    const other = await autumnVenue();
    expect(await refusal(change(v, { save: [entry(other.winter, "Winter", "11-15")] }))).toEqual({
      code: "season.not_found",
      params: { seasonId: other.winter },
    });
    expect(await refusal(change(v, { delete: [other.winter] }))).toEqual({
      code: "season.not_found",
      params: { seasonId: other.winter },
    });
    expect(await seasonsOf(v)).toEqual(THREE);
    expect(await seasonsOf(other)).toEqual(THREE);
  });

  it("refuses an id sent twice, or both saved and deleted", async () => {
    const v = await autumnVenue();
    expect(
      await refusal(
        change(v, { save: [entry(v.winter, "Winter", "12-01"), entry(v.winter, "Cold", "12-05")] }),
      ),
    ).toEqual({ code: "season.invalid", params: { field: "save.1.id" } });
    expect(
      await refusal(change(v, { save: [entry(v.winter, "Cold", "12-01")], delete: [v.winter] })),
    ).toEqual({ code: "season.invalid", params: { field: "save.0.id" } });
    expect(await seasonsOf(v)).toEqual(THREE);
  });

  it("refuses a delete under a stale clock revision before anything changes", async () => {
    const v = await autumnVenue();
    const weeksBefore = await everyWeek(v);
    expect(await refusal(change(v, { delete: [v.winter] }, 1))).toEqual({
      code: "hours.clock_changed",
      params: {},
    });
    expect(await seasonsOf(v)).toEqual(THREE);
    expect(await everyWeek(v)).toEqual(weeksBefore);
  });

  it("refuses an id that is not a string at its own path", async () => {
    const v = await autumnVenue();
    for (const id of [null, 7])
      expect(
        await refusal(
          change(v, {
            save: [
              { id: id as unknown as string, name: "Cold", startsOn: "12-05", colour: "grey" },
            ],
          }),
        ),
      ).toEqual({ code: "season.invalid", params: { field: "save.0.id" } });
    expect(await seasonsOf(v)).toEqual(THREE);
  });

  it("names the entry whose changed name or start clashes, not a later one keeping its own", async () => {
    const v = await autumnVenue();
    expect(
      await refusal(
        change(v, {
          save: [
            entry(v.lateAutumn, "Winter", "11-01"),
            entry(v.winter, "Winter", "12-01", "teal"),
          ],
        }),
      ),
    ).toEqual({ code: "season.invalid", params: { field: "save.0.name", reason: "taken" } });
    expect(
      await refusal(
        change(v, {
          save: [
            entry(v.lateAutumn, "Late autumn", "12-01"),
            entry(v.winter, "Winter", "12-01", "teal"),
          ],
        }),
      ),
    ).toEqual({ code: "season.invalid", params: { field: "save.0.startsOn", reason: "taken" } });
    expect(await seasonsOf(v)).toEqual(THREE);
  });

  it("adds Christmas weeks, a copy of Winter's department and zone weeks", async () => {
    const v = await autumnVenue();
    const saved = await change(v, { save: [entry(undefined, "Christmas weeks", "12-20", "red")] });
    const christmas = saved.find((season) => season.name === "Christmas weeks")!;
    expect(christmas).toEqual({
      id: expect.any(String),
      name: "Christmas weeks",
      startsOn: "12-20",
      colour: "red",
    });
    expect(await seasonOnDay(v, "2030-12-20")).toBe(christmas.id);
    expect(await restaurantWeek(v, christmas.id)).toEqual(v.winterWeek);
    expect(await terrazaWeek(v, christmas.id)).toEqual(v.zoneWeek);
    // By value: emptying Winter leaves the copy alone.
    await scoped((tx) => writeDepartmentSeasonWeeks(tx, v.restaurant, [v.winter], EMPTY_WEEK()));
    expect(await restaurantWeek(v, christmas.id)).toEqual(v.winterWeek);
  });

  it("splits Autumn with Mid autumn from 10-01, whose copied weeks border cleanly", async () => {
    const v = await autumnVenue();
    const saved = await change(v, { save: [entry(undefined, " Mid autumn ", "10-01")] });
    const mid = saved.find((season) => season.startsOn === "10-01")!;
    expect(mid.name).toBe("Mid autumn");
    expect(await restaurantWeek(v, mid.id)).toEqual(v.autumnWeek);
    expect(await terrazaWeek(v, mid.id)).toEqual(v.zoneWeek);
    expect(
      (await scoped((tx) => readDepartmentSeasonWeeks(tx, v.cfg, [v.bar]))).get(v.bar)?.get(mid.id),
    ).toEqual(EMPTY_WEEK());
  });

  it("gives a venue without seasons its four before adding", async () => {
    const locationId = await newLocation("No seasons yet, saveSeasons");
    const saved = await change(
      { cfg: { locationId } },
      { save: [entry(undefined, "Feria", "04-10")] },
    );
    expect(shape(saved)).toEqual([
      { name: "Spring", startsOn: "03-01" },
      { name: "Feria", startsOn: "04-10" },
      { name: "Summer", startsOn: "06-01" },
      { name: "Autumn", startsOn: "09-01" },
      { name: "Winter", startsOn: "12-01" },
    ]);
    expect(await scoped((tx) => readSeasons(tx, { locationId }))).toEqual(saved);
  });

  it("refuses an add's bad or taken start, taken name, and stale revision", async () => {
    const v = await autumnVenue();
    const add = (name: string, startsOn: string, revision = 0) =>
      refusal(change(v, { save: [entry(undefined, name, startsOn)] }, revision));
    expect(await add("Leap", "02-29")).toEqual({
      code: "season.invalid",
      params: { field: "save.0.startsOn" },
    });
    expect(await add("Again", "12-01")).toEqual({
      code: "season.invalid",
      params: { field: "save.0.startsOn", reason: "taken" },
    });
    expect(await add("Autumn", "10-01")).toEqual({
      code: "season.invalid",
      params: { field: "save.0.name", reason: "taken" },
    });
    expect(await add("Mid autumn", "10-01", 1)).toEqual({
      code: "hours.clock_changed",
      params: {},
    });
    expect(await seasonsOf(v)).toEqual(THREE);
  });

  it("gives a deleted season's days back to the one before and removes its weeks", async () => {
    const v = await autumnVenue();
    const added = await change(v, { save: [entry(undefined, "Christmas weeks", "12-20")] });
    const christmas = added.find((season) => season.startsOn === "12-20")!;
    await change(v, { delete: [christmas.id] });
    expect(await seasonOnDay(v, "2030-12-20")).toBe(v.winter);
    expect(await seasonsOf(v)).toEqual(THREE);
    expect(
      await db.select().from(departmentDays).where(eq(departmentDays.seasonId, christmas.id)),
    ).toEqual([]);
    expect(await db.select().from(zoneDays).where(eq(zoneDays.seasonId, christmas.id))).toEqual([]);
  });

  it("gives the first season's days to the last one when the first is deleted, and removes its weeks", async () => {
    const v = await autumnVenue();
    expect(await seasonOnDay(v, "2030-09-15")).toBe(v.autumn);
    expect(await terrazaWeek(v, v.autumn)).toEqual(v.zoneWeek);
    await change(v, { delete: [v.autumn] });
    expect(await seasonOnDay(v, "2030-09-15")).toBe(v.winter);
    expect(await seasonsOf(v)).toEqual(THREE.slice(1));
    expect(
      await db.select().from(departmentDays).where(eq(departmentDays.seasonId, v.autumn)),
    ).toEqual([]);
    expect(await db.select().from(zoneDays).where(eq(zoneDays.seasonId, v.autumn))).toEqual([]);
    expect(await restaurantWeek(v, v.winter)).toEqual(v.winterWeek);
  });

  it("refuses deleting every season", async () => {
    const locationId = await newLocation("Lone season, saveSeasons");
    const [only] = await db
      .insert(seasons)
      .values({ locationId, name: "All year", startsOn: "01-01" })
      .returning({ id: seasons.id });
    expect(await refusal(change({ cfg: { locationId } }, { delete: [only!.id] }))).toEqual({
      code: "season.invalid",
      params: { field: "delete", reason: "last" },
    });
    expect(await scoped((tx) => readSeasons(tx, { locationId }))).toHaveLength(1);
  });

  it("refuses a delete that makes Autumn's Saturday Dinner send into Winter's Sunday Breakfast", async () => {
    const v = await autumnVenue();
    expect(await refusal(change(v, { delete: [v.lateAutumn] }))).toEqual({
      code: "season.invalid",
      params: {
        field: "seasons",
        reason: "end_offset",
        seasonId: v.autumn,
        weekday: SATURDAY,
        periodId: v.dinner,
        departmentId: v.restaurant,
      },
    });
    expect(await seasonsOf(v)).toEqual(THREE);
  });

  it("swaps Summer's and Autumn's starts and their names in one call, each id keeping its weeks", async () => {
    const cfg: VenueScope = { locationId: await newLocation("Swapped seasons") };
    const [, summer, autumn] = await scoped((tx) => ensureDefaultSeasons(tx, cfg));
    const kitchen = (await scoped((tx) => createDepartment(tx, cfg, { name: "Kitchen" }))).id;
    await scoped((tx) => writeDepartmentSeasonWeeks(tx, kitchen, [summer!.id], EMPTY_WEEK()));
    const daysOf = (seasonId: string) =>
      db.select().from(departmentDays).where(eq(departmentDays.seasonId, seasonId));
    const summerDays = await daysOf(summer!.id);
    expect(summerDays).toHaveLength(7);
    expect(await daysOf(autumn!.id)).toEqual([]);
    const saved = await change(
      { cfg },
      {
        save: [
          entry(summer!.id, "Autumn", "09-01", summer!.colour),
          entry(autumn!.id, "Summer", "06-01", autumn!.colour),
        ],
      },
    );
    expect(saved.map(({ id, name, startsOn }) => ({ id, name, startsOn }))).toEqual([
      expect.objectContaining({ name: "Spring", startsOn: "03-01" }),
      { id: autumn!.id, name: "Summer", startsOn: "06-01" },
      { id: summer!.id, name: "Autumn", startsOn: "09-01" },
      expect.objectContaining({ name: "Winter", startsOn: "12-01" }),
    ]);
    expect(await daysOf(summer!.id)).toEqual(summerDays);
    expect(await daysOf(autumn!.id)).toEqual([]);
  });

  it("stores each entry's colour, and refuses one outside the calendar colours", async () => {
    const v = await autumnVenue();
    await change(v, { save: [entry(v.lateAutumn, "Late autumn", "11-01", "sky")] });
    expect(
      (await scoped((tx) => readSeasons(tx, v.cfg))).find((season) => season.id === v.lateAutumn)
        ?.colour,
    ).toBe("sky");
    await change(v, { save: [entry(v.lateAutumn, "Late autumn", "11-01", "teal")] });
    const read = await scoped((tx) => readSeasons(tx, v.cfg));
    expect(read.find((season) => season.id === v.lateAutumn)?.colour).toBe("teal");
    expect(
      await refusal(
        change(v, {
          save: [
            {
              id: v.lateAutumn,
              name: "Late autumn",
              startsOn: "11-01",
              colour: "mauve" as CalendarColour,
            },
          ],
        }),
      ),
    ).toEqual({ code: "season.invalid", params: { field: "save.0.colour" } });
    expect(await scoped((tx) => readSeasons(tx, v.cfg))).toEqual(read);
  });

  it("adds, moves, recolours and deletes in one call, answering the venue's seasons by start", async () => {
    const v = await autumnVenue();
    // Early splits Winter, which the Bar never painted; Mid autumn splits Autumn, which it did;
    // Advent splits Late autumn, which the Terraza never painted.
    const saved = await change(v, {
      save: [
        entry(undefined, "Mid autumn", "10-01", "pink"),
        entry(v.lateAutumn, "Late autumn", "11-10"),
        entry(v.autumn, "Autumn", "09-01", "red"),
        entry(undefined, "Early", "01-15", "lime"),
        entry(undefined, "Advent", "11-20", "purple"),
      ],
      delete: [v.winter],
    });
    const mid = saved.find((season) => season.name === "Mid autumn")!;
    const early = saved.find((season) => season.name === "Early")!;
    const advent = saved.find((season) => season.name === "Advent")!;
    expect(saved).toEqual([
      { id: early.id, name: "Early", startsOn: "01-15", colour: "lime" },
      { id: v.autumn, name: "Autumn", startsOn: "09-01", colour: "red" },
      { id: mid.id, name: "Mid autumn", startsOn: "10-01", colour: "pink" },
      { id: v.lateAutumn, name: "Late autumn", startsOn: "11-10", colour: "grey" },
      { id: advent.id, name: "Advent", startsOn: "11-20", colour: "purple" },
    ]);
    expect(await restaurantWeek(v, advent.id)).toEqual(EMPTY_WEEK());
    expect(await terrazaWeek(v, advent.id)).toBeUndefined();
    expect(await scoped((tx) => readSeasons(tx, v.cfg))).toEqual(saved);
    expect(await restaurantWeek(v, mid.id)).toEqual(v.autumnWeek);
    expect(await restaurantWeek(v, early.id)).toEqual(v.winterWeek);
    expect(await terrazaWeek(v, early.id)).toEqual(v.zoneWeek);
    const barWeeks = (await scoped((tx) => readDepartmentSeasonWeeks(tx, v.cfg, [v.bar]))).get(
      v.bar,
    );
    expect(barWeeks?.get(mid.id)).toEqual(EMPTY_WEEK());
    expect(barWeeks?.has(early.id)).toBe(false);
    expect(
      await db.select().from(departmentDays).where(eq(departmentDays.seasonId, v.winter)),
    ).toEqual([]);
  });

  it("refuses a duplicate between two sent entries naming the later one", async () => {
    const v = await autumnVenue();
    expect(
      await refusal(
        change(v, {
          save: [entry(undefined, "Feria", "04-10"), entry(undefined, "Feria", "05-10")],
        }),
      ),
    ).toEqual({ code: "season.invalid", params: { field: "save.1.name", reason: "taken" } });
    expect(
      await refusal(
        change(v, {
          save: [entry(undefined, "Feria", "04-10"), entry(undefined, "Fiesta", "04-10")],
        }),
      ),
    ).toEqual({ code: "season.invalid", params: { field: "save.1.startsOn", reason: "taken" } });
    expect(await seasonsOf(v)).toEqual(THREE);
  });

  it("a refusal anywhere writes nothing", async () => {
    const v = await autumnVenue();
    const seasonsBefore = await scoped((tx) => readSeasons(tx, v.cfg));
    const weeksBefore = await everyWeek(v);
    expect(
      await refusal(
        change(v, {
          save: [
            entry(v.autumn, "Autumn", "09-01", "red"),
            entry(undefined, "Mid autumn", "10-01"),
            entry(v.winter, "Winter", "02-29"),
          ],
        }),
      ),
    ).toEqual({ code: "season.invalid", params: { field: "save.2.startsOn" } });
    // Refused after its writes: deleting Late autumn makes Autumn's Dinner send into Winter.
    expect(
      await refusal(
        change(v, {
          save: [entry(v.autumn, "Fall", "09-05", "red"), entry(undefined, "Feria", "04-10")],
          delete: [v.lateAutumn],
        }),
      ),
    ).toMatchObject({ code: "season.invalid", params: { field: "seasons", reason: "end_offset" } });
    expect(await scoped((tx) => readSeasons(tx, v.cfg))).toEqual(seasonsBefore);
    expect(await everyWeek(v)).toEqual(weeksBefore);
  });

  it("a new season inside a season deleted in the same call copies the deleted season's weeks", async () => {
    const v = await autumnVenue();
    const saved = await change(v, {
      save: [entry(undefined, "Christmas", "12-20")],
      delete: [v.winter],
    });
    const christmas = saved.find((season) => season.name === "Christmas")!;
    expect(shape(saved)).toEqual([
      { name: "Autumn", startsOn: "09-01" },
      { name: "Late autumn", startsOn: "11-01" },
      { name: "Christmas", startsOn: "12-20" },
    ]);
    expect(await restaurantWeek(v, christmas.id)).toEqual(v.winterWeek);
    expect(await terrazaWeek(v, christmas.id)).toEqual(v.zoneWeek);
  });

  it("temporaryStart gives 365 distinct values no real start can equal and the table accepts", () => {
    const values = Array.from({ length: 365 }, (_, i) => temporaryStart(i));
    expect(new Set(values).size).toBe(365);
    for (const value of values) {
      expect(parseSeasonStart(value)).toBeNull();
      expect(value).toMatch(/^[01][0-9]-[0-3][0-9]$/);
      expect(value).not.toBe("02-29");
    }
    expect(temporaryStart(433)).toMatch(/^[01][0-9]-[0-3][0-9]$/);
    expect(() => temporaryStart(434)).toThrow();
  });
});
