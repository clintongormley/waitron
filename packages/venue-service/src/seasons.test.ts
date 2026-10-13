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
import { locationId as brandLocationId, type LocationId } from "@waitron/shared";
import { resolveDepartmentDays } from "./day-resolver.js";
import { saveMenuPeriod } from "./menu-timetable.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { configureZone, createDepartment, type VenueScope } from "./operations.js";
import { menuPeriods } from "./schema/menus.js";
import { departmentDays, seasons, zoneDays } from "./schema/seasons.js";
import {
  readDepartmentSeasonWeeks,
  readZoneSeasonWeeks,
  writeDepartmentSeasonWeeks,
  writeZoneSeasonWeeks,
} from "./season-weeks.js";
import {
  addSeason,
  deleteSeason,
  ensureDefaultSeasons,
  readSeasons,
  saveSeason,
  seasonDeleteImpact,
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

  it("leaves a location that already has a season alone", async () => {
    const locationId = await newLocation("One season");
    const [own] = await db
      .insert(seasons)
      .values({ locationId, name: "All year", startsOn: "01-01" })
      .returning({ id: seasons.id });
    const result = await withTransaction(db, (tx) => ensureDefaultSeasons(tx, { locationId }));
    expect(result).toEqual([{ id: own!.id, name: "All year", startsOn: "01-01" }]);
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

describe("saveSeason", () => {
  it.each(["02-29", "13-01", "04-31", "1-1"])("refuses the start %s", async (startsOn) => {
    const v = await autumnVenue();
    expect(
      await refusal(
        scoped((tx) => saveSeason(tx, v.cfg, v.winter, { name: "Winter", startsOn }, AT, 0)),
      ),
    ).toEqual({ code: "season.invalid", params: { field: "startsOn" } });
    expect(await seasonsOf(v)).toEqual(THREE);
  });

  it("refuses a start another season holds", async () => {
    const v = await autumnVenue();
    expect(
      await refusal(
        scoped((tx) =>
          saveSeason(tx, v.cfg, v.winter, { name: "Winter", startsOn: "11-01" }, AT, 0),
        ),
      ),
    ).toEqual({ code: "season.invalid", params: { field: "startsOn", reason: "taken" } });
  });

  it("refuses a name another season holds, as trimmed, and an empty name", async () => {
    const v = await autumnVenue();
    expect(
      await refusal(
        scoped((tx) =>
          saveSeason(tx, v.cfg, v.lateAutumn, { name: "  Winter ", startsOn: "11-01" }, AT, 0),
        ),
      ),
    ).toEqual({ code: "season.invalid", params: { field: "name", reason: "taken" } });
    expect(
      await refusal(
        scoped((tx) =>
          saveSeason(tx, v.cfg, v.lateAutumn, { name: "   ", startsOn: "11-01" }, AT, 0),
        ),
      ),
    ).toEqual({ code: "season.invalid", params: { field: "name" } });
    expect(await seasonsOf(v)).toEqual(THREE);
  });

  it("renames a season, trimming the name, and keeps its own start", async () => {
    const v = await autumnVenue();
    const saved = await scoped((tx) =>
      saveSeason(tx, v.cfg, v.lateAutumn, { name: " Fall ", startsOn: "11-01" }, AT, 0),
    );
    expect(saved).toEqual({ id: v.lateAutumn, name: "Fall", startsOn: "11-01" });
  });

  it("moves Winter to 11-15, so 20 November resolves to Winter on the next read", async () => {
    const v = await autumnVenue();
    expect(await seasonOnDay(v, "2030-11-20")).toBe(v.lateAutumn);
    const saved = await scoped((tx) =>
      saveSeason(tx, v.cfg, v.winter, { name: "Winter", startsOn: "11-15" }, AT, 0),
    );
    expect(saved).toEqual({ id: v.winter, name: "Winter", startsOn: "11-15" });
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
    expect(
      await refusal(
        scoped((tx) =>
          saveSeason(tx, v.cfg, v.winter, { name: "Winter", startsOn: "11-10" }, AT, 0),
        ),
      ),
    ).toEqual({
      code: "season.invalid",
      params: {
        field: "startsOn",
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
    expect(
      await refusal(
        scoped((tx) =>
          saveSeason(tx, v.cfg, v.winter, { name: "Winter", startsOn: "11-15" }, AT, 1),
        ),
      ),
    ).toEqual({ code: "hours.clock_changed", params: {} });
    expect(await seasonsOf(v)).toEqual(THREE);
  });

  it("refuses another venue's season", async () => {
    const v = await autumnVenue();
    const other = await autumnVenue();
    expect(
      await refusal(
        scoped((tx) =>
          saveSeason(tx, v.cfg, other.winter, { name: "Winter", startsOn: "11-15" }, AT, 0),
        ),
      ),
    ).toEqual({ code: "season.not_found", params: { seasonId: other.winter } });
  });
});

describe("addSeason", () => {
  it("adds Christmas weeks, a copy of Winter's department and zone weeks", async () => {
    const v = await autumnVenue();
    const christmas = await scoped((tx) =>
      addSeason(tx, v.cfg, { name: "Christmas weeks", startsOn: "12-20" }, AT, 0),
    );
    expect(christmas).toEqual({
      id: expect.any(String),
      name: "Christmas weeks",
      startsOn: "12-20",
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
    const mid = await scoped((tx) =>
      addSeason(tx, v.cfg, { name: " Mid autumn ", startsOn: "10-01" }, AT, 0),
    );
    expect(mid.name).toBe("Mid autumn");
    expect(await restaurantWeek(v, mid.id)).toEqual(v.autumnWeek);
    expect(await terrazaWeek(v, mid.id)).toEqual(v.zoneWeek);
    expect(
      (await scoped((tx) => readDepartmentSeasonWeeks(tx, v.cfg, [v.bar]))).get(v.bar)?.get(mid.id),
    ).toEqual(EMPTY_WEEK());
  });

  it("gives a venue without seasons its four before adding", async () => {
    const locationId = await newLocation("No seasons yet");
    const added = await scoped((tx) =>
      addSeason(tx, { locationId }, { name: "Feria", startsOn: "04-10" }, AT, 0),
    );
    expect(added.startsOn).toBe("04-10");
    expect(shape(await scoped((tx) => readSeasons(tx, { locationId })))).toEqual([
      { name: "Spring", startsOn: "03-01" },
      { name: "Feria", startsOn: "04-10" },
      { name: "Summer", startsOn: "06-01" },
      { name: "Autumn", startsOn: "09-01" },
      { name: "Winter", startsOn: "12-01" },
    ]);
  });

  it("refuses a bad or taken start, a taken name, and a stale revision", async () => {
    const v = await autumnVenue();
    const add = (name: string, startsOn: string, revision = 0) =>
      refusal(scoped((tx) => addSeason(tx, v.cfg, { name, startsOn }, AT, revision)));
    expect(await add("Leap", "02-29")).toEqual({
      code: "season.invalid",
      params: { field: "startsOn" },
    });
    expect(await add("Again", "12-01")).toEqual({
      code: "season.invalid",
      params: { field: "startsOn", reason: "taken" },
    });
    expect(await add("Autumn", "10-01")).toEqual({
      code: "season.invalid",
      params: { field: "name", reason: "taken" },
    });
    expect(await add("Mid autumn", "10-01", 1)).toEqual({
      code: "hours.clock_changed",
      params: {},
    });
    expect(await seasonsOf(v)).toEqual(THREE);
  });
});

describe("deleteSeason", () => {
  it("gives a deleted season's days back to the one before and removes its weeks", async () => {
    const v = await autumnVenue();
    const christmas = await scoped((tx) =>
      addSeason(tx, v.cfg, { name: "Christmas weeks", startsOn: "12-20" }, AT, 0),
    );
    await scoped((tx) => deleteSeason(tx, v.cfg, christmas.id, AT, 0));
    expect(await seasonOnDay(v, "2030-12-20")).toBe(v.winter);
    expect(await seasonsOf(v)).toEqual(THREE);
    expect(
      await db.select().from(departmentDays).where(eq(departmentDays.seasonId, christmas.id)),
    ).toEqual([]);
    expect(await db.select().from(zoneDays).where(eq(zoneDays.seasonId, christmas.id))).toEqual([]);
  });

  it("refuses deleting the last season", async () => {
    const locationId = await newLocation("Lone season");
    const [only] = await db
      .insert(seasons)
      .values({ locationId, name: "All year", startsOn: "01-01" })
      .returning({ id: seasons.id });
    expect(
      await refusal(scoped((tx) => deleteSeason(tx, { locationId }, only!.id, AT, 0))),
    ).toEqual({ code: "season.invalid", params: { field: "seasonId", reason: "last" } });
    expect(await scoped((tx) => readSeasons(tx, { locationId }))).toHaveLength(1);
  });

  it("refuses a delete that makes Autumn's Saturday Dinner send into Winter's Sunday Breakfast", async () => {
    const v = await autumnVenue();
    expect(await refusal(scoped((tx) => deleteSeason(tx, v.cfg, v.lateAutumn, AT, 0)))).toEqual({
      code: "season.invalid",
      params: {
        field: "seasonId",
        reason: "end_offset",
        seasonId: v.autumn,
        weekday: SATURDAY,
        periodId: v.dinner,
        departmentId: v.restaurant,
      },
    });
    expect(await seasonsOf(v)).toEqual(THREE);
  });

  it("refuses a stale revision and another venue's season", async () => {
    const v = await autumnVenue();
    const other = await autumnVenue();
    expect(await refusal(scoped((tx) => deleteSeason(tx, v.cfg, v.winter, AT, 1)))).toEqual({
      code: "hours.clock_changed",
      params: {},
    });
    expect(await refusal(scoped((tx) => deleteSeason(tx, v.cfg, other.winter, AT, 0)))).toEqual({
      code: "season.not_found",
      params: { seasonId: other.winter },
    });
    expect(await seasonsOf(v)).toEqual(THREE);
  });
});

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
