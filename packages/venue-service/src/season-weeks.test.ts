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
import { locationId as brandLocationId } from "@waitron/shared";
import { readOpeningHoursModel, replaceMenuWeek, saveMenuPeriod } from "./menu-timetable.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { configureZone, createDepartment, type VenueScope } from "./operations.js";
import {
  departmentDayRanges,
  departmentDays,
  seasons,
  zoneDayRanges,
  zoneDays,
} from "./schema/seasons.js";
import {
  joinTouching,
  readDepartmentSeasonWeeks,
  readZoneSeasonWeeks,
  writeDepartmentSeasonWeeks,
  writeZoneSeasonWeeks,
} from "./season-weeks.js";
import { readSeasons } from "./seasons.js";
import type { ServiceRange } from "./service-day.js";
import { readZoneClosedTimes, replaceZoneClosedWeek } from "./zone-closed-times.js";

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
const TUESDAY = 2;

async function venue() {
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
  const [zone] = await db
    .insert(floorZones)
    .values({ locationId: cfg.locationId, name: "Sala", displayOrder: 0 })
    .returning({ id: floorZones.id });
  return scoped(async (tx) => {
    const departmentId = (
      await createDepartment(tx, cfg, { name: "Restaurant", orderStart: "table" })
    ).id;
    await configureZone(tx, cfg, { zoneId: zone!.id, departmentId });
    const period = async (name: string) => {
      const menuId = (await createCatalogue(tx, { name })).id;
      const { document } = await buildMenuDocument(tx, menuId);
      await publishMenu(tx, menuId, menuDocumentHash(document), "person-1");
      return (await saveMenuPeriod(tx, cfg, departmentId, { name, menuId, staffMenuIds: [] }, 0))
        .id;
    };
    return {
      cfg,
      departmentId,
      zoneId: zone!.id,
      lunch: await period("Lunch"),
      dinner: await period("Dinner"),
    };
  });
}
type Venue = Awaited<ReturnType<typeof venue>>;

const menuWeek = (tuesday: { periodId: string; startsAt: string; endsAt: string }[]) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    slots: weekday === TUESDAY ? tuesday : [],
  }));
const closedWeek = (tuesday: { startsAt: string; endsAt: string }[]) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    ranges: weekday === TUESDAY ? tuesday : [],
  }));

async function seasonIds(v: Venue): Promise<Record<string, string>> {
  const rows = await scoped((tx) => readSeasons(tx, v.cfg));
  return Object.fromEntries(rows.map((season) => [season.name, season.id]));
}
async function departmentTuesdays(v: Venue): Promise<Record<string, ServiceRange[]>> {
  const ids = await seasonIds(v);
  const weeks = await scoped((tx) => readDepartmentSeasonWeeks(tx, v.cfg, [v.departmentId]));
  const own = weeks.get(v.departmentId);
  return Object.fromEntries(
    Object.entries(ids).map(([name, id]) => [name, own?.get(id)?.[TUESDAY] ?? []]),
  );
}
async function zoneTuesdays(v: Venue) {
  const ids = await seasonIds(v);
  const weeks = await scoped((tx) => readZoneSeasonWeeks(tx, v.cfg, [v.zoneId]));
  const own = weeks.get(v.zoneId);
  return Object.fromEntries(
    Object.entries(ids).map(([name, id]) => [name, own?.get(id)?.[TUESDAY] ?? []]),
  );
}
const everySeason = <T>(value: T) => ({
  Spring: value,
  Summer: value,
  Autumn: value,
  Winter: value,
});

describe("replaceMenuWeek writes season weeks", () => {
  it("with no season named, gives a venue without seasons its four and paints every one, and the model's current season week holds it", async () => {
    const v = await venue();
    expect(await scoped((tx) => readSeasons(tx, v.cfg))).toEqual([]);
    const lunch = { periodId: v.lunch, startsAt: "13:00", endsAt: "16:00" };
    await scoped((tx) => replaceMenuWeek(tx, v.cfg, v.departmentId, menuWeek([lunch]), AT, 0));
    expect(Object.keys(await seasonIds(v))).toEqual(["Spring", "Summer", "Autumn", "Winter"]);
    expect(await departmentTuesdays(v)).toEqual(everySeason([lunch]));
    const weeks = await scoped((tx) => readDepartmentSeasonWeeks(tx, v.cfg, [v.departmentId]));
    for (const week of weeks.get(v.departmentId)!.values())
      expect(week).toEqual([[], [], [lunch], [], [], [], []]);
    const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    expect(model.currentSeasonId).toBe((await seasonIds(v)).Autumn);
    const department = model.departments.find((entry) => entry.id === v.departmentId)!;
    expect(
      department.seasonWeeks
        .find((entry) => entry.seasonId === model.currentSeasonId)!
        .week.find((day) => day.weekday === TUESDAY)!.slots,
    ).toEqual([lunch]);
  });

  it("with a season named, changes that season alone, and the model's current season week keeps the old week", async () => {
    const v = await venue();
    const lunch = { periodId: v.lunch, startsAt: "13:00", endsAt: "16:00" };
    const dinner = { periodId: v.dinner, startsAt: "20:00", endsAt: "23:00" };
    await scoped((tx) => replaceMenuWeek(tx, v.cfg, v.departmentId, menuWeek([lunch]), AT, 0));
    const { Winter } = await seasonIds(v);
    await scoped((tx) =>
      replaceMenuWeek(tx, v.cfg, v.departmentId, menuWeek([dinner]), AT, 0, {
        seasonId: Winter!,
      }),
    );
    expect(await departmentTuesdays(v)).toEqual({
      Spring: [lunch],
      Summer: [lunch],
      Autumn: [lunch],
      Winter: [dinner],
    });
    const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    expect(model.currentSeasonId).toBe((await seasonIds(v)).Autumn);
    const department = model.departments.find((entry) => entry.id === v.departmentId)!;
    expect(
      department.seasonWeeks
        .find((entry) => entry.seasonId === model.currentSeasonId)!
        .week.find((day) => day.weekday === TUESDAY)!.slots,
    ).toEqual([lunch]);
  });

  it("with no season named, counts a season's differing week as a time change, so a stale clock revision is refused", async () => {
    const v = await venue();
    const lunch = { periodId: v.lunch, startsAt: "13:00", endsAt: "16:00" };
    const dinner = { periodId: v.dinner, startsAt: "20:00", endsAt: "23:00" };
    await scoped((tx) => replaceMenuWeek(tx, v.cfg, v.departmentId, menuWeek([lunch]), AT, 0));
    const { Winter } = await seasonIds(v);
    await scoped((tx) =>
      replaceMenuWeek(tx, v.cfg, v.departmentId, menuWeek([dinner]), AT, 0, {
        seasonId: Winter!,
      }),
    );
    await expect(
      scoped((tx) => replaceMenuWeek(tx, v.cfg, v.departmentId, menuWeek([lunch]), AT, 5)),
    ).rejects.toMatchObject({ code: "hours.clock_changed" });
    expect((await departmentTuesdays(v)).Winter).toEqual([dinner]);
    await scoped((tx) => replaceMenuWeek(tx, v.cfg, v.departmentId, menuWeek([lunch]), AT, 0));
    expect(await departmentTuesdays(v)).toEqual(everySeason([lunch]));
    await expect(
      scoped((tx) => replaceMenuWeek(tx, v.cfg, v.departmentId, menuWeek([lunch]), AT, 5)),
    ).resolves.toBeUndefined();
  });

  it("counts an unchanged week as no time change when a season stores it as touching ranges of one period, as an import may", async () => {
    const v = await venue();
    const split = [
      { periodId: v.lunch, startsAt: "13:00", endsAt: "14:00" },
      { periodId: v.lunch, startsAt: "14:00", endsAt: "16:00" },
    ];
    await scoped((tx) => replaceMenuWeek(tx, v.cfg, v.departmentId, menuWeek(split), AT, 0));
    const stored = [0, 1, 2, 3, 4, 5, 6].map((weekday) => (weekday === TUESDAY ? split : []));
    for (const seasonId of Object.values(await seasonIds(v)))
      await scoped((tx) => writeDepartmentSeasonWeeks(tx, v.departmentId, [seasonId], stored));
    expect(await departmentTuesdays(v)).toEqual(everySeason(split));
    await expect(
      scoped((tx) => replaceMenuWeek(tx, v.cfg, v.departmentId, menuWeek(split), AT, 5)),
    ).resolves.toBeUndefined();
  });

  it("joins touching ranges of one period, and keeps touching ranges of two periods apart", async () => {
    const v = await venue();
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.departmentId,
        menuWeek([
          { periodId: v.lunch, startsAt: "14:00", endsAt: "16:00" },
          { periodId: v.lunch, startsAt: "13:00", endsAt: "14:00" },
          { periodId: v.dinner, startsAt: "16:00", endsAt: "18:00" },
        ]),
        AT,
        0,
      ),
    );
    expect(await departmentTuesdays(v)).toEqual(
      everySeason([
        { periodId: v.lunch, startsAt: "13:00", endsAt: "16:00" },
        { periodId: v.dinner, startsAt: "16:00", endsAt: "18:00" },
      ]),
    );
  });

  it("refuses a season it does not know, or another venue's, writing nothing", async () => {
    const v = await venue();
    const other = await venue();
    await scoped((tx) => replaceMenuWeek(tx, other.cfg, other.departmentId, menuWeek([]), AT, 0));
    const theirs = Object.values(await seasonIds(other))[0]!;
    for (const seasonId of [randomUUID(), theirs])
      await expect(
        scoped((tx) =>
          replaceMenuWeek(
            tx,
            v.cfg,
            v.departmentId,
            menuWeek([{ periodId: v.lunch, startsAt: "13:00", endsAt: "16:00" }]),
            AT,
            0,
            { seasonId },
          ),
        ),
      ).rejects.toMatchObject({ code: "season.not_found", params: { seasonId } });
    expect(await scoped((tx) => readSeasons(tx, v.cfg))).toEqual([]);
  });

  it("never writes a Closed range into a season week", async () => {
    const v = await venue();
    await expect(
      scoped((tx) =>
        replaceMenuWeek(
          tx,
          v.cfg,
          v.departmentId,
          menuWeek([{ periodId: null as unknown as string, startsAt: "13:00", endsAt: "16:00" }]),
          AT,
          0,
        ),
      ),
    ).rejects.toMatchObject({ code: "menu_timetable.invalid" });
    await scoped((tx) => replaceMenuWeek(tx, v.cfg, v.departmentId, menuWeek([]), AT, 0));
    const { Winter } = await seasonIds(v);
    const week = [0, 1, 2, 3, 4, 5, 6].map((weekday) =>
      weekday === TUESDAY
        ? [{ periodId: null as unknown as string, startsAt: "13:00", endsAt: "16:00" }]
        : [],
    );
    await expect(
      scoped((tx) => writeDepartmentSeasonWeeks(tx, v.departmentId, [Winter!], week)),
    ).rejects.toThrow("a season week takes periods only");
    expect(await db.select().from(departmentDayRanges)).not.toContainEqual(
      expect.objectContaining({ departmentId: v.departmentId }),
    );
  });
});

describe("replaceZoneClosedWeek writes season weeks", () => {
  it("with no season named, gives a venue without seasons its four and closes every one, and the zone's read shows each season's week", async () => {
    const v = await venue();
    const night = { startsAt: "23:00", endsAt: "02:00" };
    await scoped((tx) => replaceZoneClosedWeek(tx, v.cfg, v.zoneId, closedWeek([night]), 0, AT));
    expect(Object.keys(await seasonIds(v))).toEqual(["Spring", "Summer", "Autumn", "Winter"]);
    expect(await zoneTuesdays(v)).toEqual(everySeason([night]));
    const { Autumn } = await seasonIds(v);
    const [zone] = await scoped((tx) => readZoneClosedTimes(tx, v.cfg, "06:00"));
    expect(zone!.seasonWeeks.find((s) => s.seasonId === Autumn)!.week[TUESDAY]!.ranges).toEqual([
      night,
    ]);
  });

  it("with a season named, changes that season alone, and the zone's read shows each season's week", async () => {
    const v = await venue();
    const night = { startsAt: "23:00", endsAt: "02:00" };
    const afternoon = { startsAt: "16:00", endsAt: "19:00" };
    await scoped((tx) => replaceZoneClosedWeek(tx, v.cfg, v.zoneId, closedWeek([night]), 0, AT));
    const { Winter } = await seasonIds(v);
    await scoped((tx) =>
      replaceZoneClosedWeek(tx, v.cfg, v.zoneId, closedWeek([afternoon]), 0, AT, {
        seasonId: Winter!,
      }),
    );
    expect(await zoneTuesdays(v)).toEqual({
      Spring: [night],
      Summer: [night],
      Autumn: [night],
      Winter: [afternoon],
    });
    const [winterZone] = await scoped((tx) => readZoneClosedTimes(tx, v.cfg, "06:00"));
    expect(
      winterZone!.seasonWeeks.find((s) => s.seasonId === Winter)!.week[TUESDAY]!.ranges,
    ).toEqual([afternoon]);
    const { Autumn } = await seasonIds(v);
    const [zone] = await scoped((tx) => readZoneClosedTimes(tx, v.cfg, "06:00"));
    expect(zone!.seasonWeeks.find((s) => s.seasonId === Autumn)!.week[TUESDAY]!.ranges).toEqual([
      night,
    ]);
  });

  it("with no season named, counts a season's differing week as a time change, so a stale clock revision is refused", async () => {
    const v = await venue();
    const night = { startsAt: "23:00", endsAt: "02:00" };
    const afternoon = { startsAt: "16:00", endsAt: "19:00" };
    await scoped((tx) => replaceZoneClosedWeek(tx, v.cfg, v.zoneId, closedWeek([night]), 0, AT));
    const { Winter } = await seasonIds(v);
    await scoped((tx) =>
      replaceZoneClosedWeek(tx, v.cfg, v.zoneId, closedWeek([afternoon]), 0, AT, {
        seasonId: Winter!,
      }),
    );
    await expect(
      scoped((tx) => replaceZoneClosedWeek(tx, v.cfg, v.zoneId, closedWeek([night]), 5, AT)),
    ).rejects.toMatchObject({ code: "hours.clock_changed" });
    expect((await zoneTuesdays(v)).Winter).toEqual([afternoon]);
    await scoped((tx) => replaceZoneClosedWeek(tx, v.cfg, v.zoneId, closedWeek([night]), 0, AT));
    expect(await zoneTuesdays(v)).toEqual(everySeason([night]));
    await expect(
      scoped((tx) => replaceZoneClosedWeek(tx, v.cfg, v.zoneId, closedWeek([night]), 5, AT)),
    ).resolves.toBeUndefined();
  });

  it("counts an unchanged week as no time change when a season stores it as touching ranges, as an import may", async () => {
    const v = await venue();
    const split = [
      { startsAt: "13:00", endsAt: "14:00" },
      { startsAt: "14:00", endsAt: "16:00" },
    ];
    await scoped((tx) => replaceZoneClosedWeek(tx, v.cfg, v.zoneId, closedWeek(split), 0, AT));
    const stored = [0, 1, 2, 3, 4, 5, 6].map((weekday) => (weekday === TUESDAY ? split : []));
    for (const seasonId of Object.values(await seasonIds(v)))
      await scoped((tx) => writeZoneSeasonWeeks(tx, v.zoneId, [seasonId], stored));
    expect(await zoneTuesdays(v)).toEqual(everySeason(split));
    await expect(
      scoped((tx) => replaceZoneClosedWeek(tx, v.cfg, v.zoneId, closedWeek(split), 5, AT)),
    ).resolves.toBeUndefined();
  });

  it("joins touching closed ranges", async () => {
    const v = await venue();
    await scoped((tx) =>
      replaceZoneClosedWeek(
        tx,
        v.cfg,
        v.zoneId,
        closedWeek([
          { startsAt: "14:00", endsAt: "16:00" },
          { startsAt: "13:00", endsAt: "14:00" },
        ]),
        0,
        AT,
      ),
    );
    expect(await zoneTuesdays(v)).toEqual(everySeason([{ startsAt: "13:00", endsAt: "16:00" }]));
  });

  it("refuses a season it does not know, or another venue's, writing nothing", async () => {
    const v = await venue();
    const other = await venue();
    await scoped((tx) => replaceZoneClosedWeek(tx, other.cfg, other.zoneId, closedWeek([]), 0, AT));
    const theirs = Object.values(await seasonIds(other))[0]!;
    for (const seasonId of [randomUUID(), theirs])
      await expect(
        scoped((tx) =>
          replaceZoneClosedWeek(
            tx,
            v.cfg,
            v.zoneId,
            closedWeek([{ startsAt: "13:00", endsAt: "16:00" }]),
            0,
            AT,
            { seasonId },
          ),
        ),
      ).rejects.toMatchObject({ code: "season.not_found", params: { seasonId } });
    expect(await scoped((tx) => readSeasons(tx, v.cfg))).toEqual([]);
  });

  it("writes every season range as closed, whatever kind it is handed", async () => {
    const v = await venue();
    await scoped((tx) => replaceZoneClosedWeek(tx, v.cfg, v.zoneId, closedWeek([]), 0, AT));
    const { Winter } = await seasonIds(v);
    const week = [0, 1, 2, 3, 4, 5, 6].map((weekday) =>
      weekday === TUESDAY ? [{ startsAt: "13:00", endsAt: "16:00", kind: "open" }] : [],
    );
    await scoped((tx) => writeZoneSeasonWeeks(tx, v.zoneId, [Winter!], week));
    const kinds = await db
      .select({ kind: zoneDayRanges.kind })
      .from(zoneDayRanges)
      .innerJoin(zoneDays, eq(zoneDays.id, zoneDayRanges.dayId))
      .where(eq(zoneDays.zoneId, v.zoneId));
    expect(kinds).toEqual([{ kind: "closed" }]);
  });
});

const sessionOf = (tx: Transaction) =>
  (tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }).session;
const statementsOf = (fn: (tx: Transaction) => Promise<unknown>) =>
  scoped(async (tx) => {
    const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");
    try {
      await fn(tx);
      return prepared.mock.calls.map(([query]) => (query as unknown as { sql: string }).sql);
    } finally {
      prepared.mockRestore();
    }
  });
const weekWrites = (texts: readonly string[], days: string, ranges: string) => ({
  dayDeletes: texts.filter((text) => text.startsWith(`delete from "${days}"`)).length,
  dayInserts: texts.filter((text) => text.startsWith(`insert into "${days}"`)).length,
  rangeInserts: texts.filter((text) => text.startsWith(`insert into "${ranges}"`)).length,
});
const ONE_WRITE = { dayDeletes: 1, dayInserts: 1, rangeInserts: 1 };
const NO_WRITE = { dayDeletes: 0, dayInserts: 0, rangeInserts: 0 };

describe("week writes", () => {
  it("writes every season's department week in one delete and two inserts, and leaves a season already holding the week alone", async () => {
    const v = await venue();
    const lunch = { periodId: v.lunch, startsAt: "13:00", endsAt: "16:00" };
    const dinner = { periodId: v.dinner, startsAt: "20:00", endsAt: "23:00" };
    const save = (tuesday: ServiceRange[], seasonId?: string) =>
      statementsOf((tx) =>
        replaceMenuWeek(tx, v.cfg, v.departmentId, menuWeek(tuesday), AT, 0, { seasonId }),
      );
    const rows = async () => {
      const names = Object.fromEntries(
        Object.entries(await seasonIds(v)).map(([name, id]) => [id, name]),
      );
      const found = await db
        .select({ id: departmentDays.id, seasonId: departmentDays.seasonId })
        .from(departmentDays)
        .where(eq(departmentDays.departmentId, v.departmentId));
      const bySeason: Record<string, string[]> = {};
      for (const row of found) (bySeason[names[row.seasonId!]!] ??= []).push(row.id);
      for (const ids of Object.values(bySeason)) ids.sort();
      return bySeason;
    };
    expect(weekWrites(await save([lunch]), "department_days", "department_day_ranges")).toEqual(
      ONE_WRITE,
    );
    const first = await rows();
    expect(weekWrites(await save([lunch]), "department_days", "department_day_ranges")).toEqual(
      NO_WRITE,
    );
    expect(await rows()).toEqual(first);
    const { Winter } = await seasonIds(v);
    await save([dinner], Winter);
    const winter = (await rows()).Winter;
    expect(weekWrites(await save([lunch]), "department_days", "department_day_ranges")).toEqual(
      ONE_WRITE,
    );
    const after = await rows();
    expect({ ...after, Winter: [] }).toEqual({ ...first, Winter: [] });
    expect(after.Winter).not.toEqual(winter);
    expect(await departmentTuesdays(v)).toEqual(everySeason([lunch]));
  });

  it("writes every season's zone week in one delete and two inserts, and leaves a season already holding the week alone", async () => {
    const v = await venue();
    const night = { startsAt: "23:00", endsAt: "02:00" };
    const afternoon = { startsAt: "16:00", endsAt: "19:00" };
    const save = (tuesday: { startsAt: string; endsAt: string }[], seasonId?: string) =>
      statementsOf((tx) =>
        replaceZoneClosedWeek(tx, v.cfg, v.zoneId, closedWeek(tuesday), 0, AT, { seasonId }),
      );
    const rows = async () => {
      const names = Object.fromEntries(
        Object.entries(await seasonIds(v)).map(([name, id]) => [id, name]),
      );
      const found = await db
        .select({ id: zoneDays.id, seasonId: zoneDays.seasonId })
        .from(zoneDays)
        .where(eq(zoneDays.zoneId, v.zoneId));
      const bySeason: Record<string, string[]> = {};
      for (const row of found) (bySeason[names[row.seasonId!]!] ??= []).push(row.id);
      for (const ids of Object.values(bySeason)) ids.sort();
      return bySeason;
    };
    expect(weekWrites(await save([night]), "zone_days", "zone_day_ranges")).toEqual(ONE_WRITE);
    const first = await rows();
    expect(weekWrites(await save([night]), "zone_days", "zone_day_ranges")).toEqual(NO_WRITE);
    expect(await rows()).toEqual(first);
    const { Winter } = await seasonIds(v);
    await save([afternoon], Winter);
    const winter = (await rows()).Winter;
    expect(weekWrites(await save([night]), "zone_days", "zone_day_ranges")).toEqual(ONE_WRITE);
    const after = await rows();
    expect({ ...after, Winter: [] }).toEqual({ ...first, Winter: [] });
    expect(after.Winter).not.toEqual(winter);
    expect(await zoneTuesdays(v)).toEqual(everySeason([night]));
  });

  it("reads only the seasons and weekdays it is asked for", async () => {
    const v = await venue();
    const lunch = { periodId: v.lunch, startsAt: "13:00", endsAt: "16:00" };
    const dinner = { periodId: v.dinner, startsAt: "20:00", endsAt: "23:00" };
    const night = { startsAt: "23:00", endsAt: "02:00" };
    const afternoon = { startsAt: "16:00", endsAt: "19:00" };
    await scoped(async (tx) => {
      await replaceMenuWeek(
        tx,
        v.cfg,
        v.departmentId,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: weekday === 1 ? [dinner] : weekday === TUESDAY ? [lunch] : [],
        })),
        AT,
        0,
      );
      await replaceZoneClosedWeek(
        tx,
        v.cfg,
        v.zoneId,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          ranges: weekday === 1 ? [afternoon] : weekday === TUESDAY ? [night] : [],
        })),
        0,
        AT,
      );
    });
    const { Winter } = await seasonIds(v);
    const only = { seasonIds: [Winter!], weekdays: [TUESDAY] };
    const tuesdayOnly = <T>(range: T) =>
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => (weekday === TUESDAY ? [range] : []));
    const departments = await scoped((tx) =>
      readDepartmentSeasonWeeks(tx, v.cfg, [v.departmentId], "06:00", only),
    );
    expect(departments).toEqual(
      new Map([[v.departmentId, new Map([[Winter!, tuesdayOnly(lunch)]])]]),
    );
    const zones = await scoped((tx) => readZoneSeasonWeeks(tx, v.cfg, [v.zoneId], "06:00", only));
    expect(zones).toEqual(new Map([[v.zoneId, new Map([[Winter!, tuesdayOnly(night)]])]]));
    for (const none of [
      { seasonIds: [], weekdays: [TUESDAY] },
      { seasonIds: [Winter!], weekdays: [] },
    ])
      expect(
        await statementsOf(async (tx) => {
          expect(
            await readDepartmentSeasonWeeks(tx, v.cfg, [v.departmentId], "06:00", none),
          ).toEqual(new Map());
          expect(await readZoneSeasonWeeks(tx, v.cfg, [v.zoneId], "06:00", none)).toEqual(
            new Map(),
          );
        }),
      ).toEqual([]);
  });
});

describe("joinTouching", () => {
  const same = (a: ServiceRange, b: ServiceRange) => a.periodId === b.periodId;
  it("joins a run of touching ranges of one period and keeps a gap or a change of period apart", () =>
    expect(
      joinTouching(
        [
          { periodId: "a", startsAt: "09:00", endsAt: "10:00" },
          { periodId: "a", startsAt: "10:00", endsAt: "11:00" },
          { periodId: "a", startsAt: "11:00", endsAt: "12:00" },
          { periodId: "b", startsAt: "12:00", endsAt: "13:00" },
          { periodId: "b", startsAt: "13:30", endsAt: "14:00" },
        ],
        same,
      ),
    ).toEqual([
      { periodId: "a", startsAt: "09:00", endsAt: "12:00" },
      { periodId: "b", startsAt: "12:00", endsAt: "13:00" },
      { periodId: "b", startsAt: "13:30", endsAt: "14:00" },
    ]));

  it("leaves its input unchanged", () => {
    const input = [
      { periodId: "a", startsAt: "09:00", endsAt: "10:00" },
      { periodId: "a", startsAt: "10:00", endsAt: "11:00" },
    ];
    joinTouching(input, same);
    expect(input[0]!.endsAt).toBe("10:00");
  });
});

describe("season tables only", () => {
  it("a season deleted takes its days with it", async () => {
    const v = await venue();
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.departmentId,
        menuWeek([{ periodId: v.lunch, startsAt: "13:00", endsAt: "16:00" }]),
        AT,
        0,
      ),
    );
    const { Winter } = await seasonIds(v);
    await db.delete(seasons).where(eq(seasons.id, Winter!));
    const weeks = await scoped((tx) => readDepartmentSeasonWeeks(tx, v.cfg, [v.departmentId]));
    expect([...weeks.get(v.departmentId)!.keys()]).not.toContain(Winter);
    expect(weeks.get(v.departmentId)!.size).toBe(3);
  });

});
