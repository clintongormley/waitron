import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  addProductToMenu,
  buildMenuDocument,
  createCategory,
  createMenu,
  createProduct,
  menuDocumentHash,
  publishMenu,
} from "@waitron/menu";
import {
  CORE_MIGRATIONS,
  menuPeriods,
  readVenueClock,
  seasons,
  withTransaction,
  type Database,
  type Transaction,
  openingHours,
  insertInChunks,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  seedBusinessDay,
  seedKitchenStation,
  seedPerson,
  seedVenue,
  seedZone,
} from "@waitron/db/testing/seed.js";
import { resolveDepartmentDays, resolveZoneClosedDays } from "./day-resolver.js";
import { readPlannedServiceGuides } from "./planned-service-guides.js";
import {
  readOpeningHoursModel,
  replaceMenuWeek,
  saveMenuPeriod,
  stageMenuWeek,
} from "./menu-timetable.js";
import type { MenuWeekDay } from "./menu-timetable-types.js";
import { configureZone, createDepartment, listVenueReadiness } from "./operations.js";
import {
  joinTouching,
  readDepartmentSeasonWeeks,
  readZoneSeasonWeeks,
  saveSeasonWeeks,
  seasonWeekList,
  writeDepartmentSeasonWeeks,
  writeZoneSeasonWeeks,
} from "./season-weeks.js";
import { ensureDefaultSeasons, readSeasons, saveSeasons } from "./seasons.js";
import type { ServiceRange } from "./service-day.js";
import {
  readZoneClosedTimes,
  replaceZoneClosedWeek,
  zoneClosureDays,
} from "./zone-closed-times.js";
import { deletePeriod } from "./period-delete.js";
import { readRoutingPeriods } from "./routing-periods.js";
import { englishSeasonName } from "./testing/starter-seasons.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  timeoutMs: 60_000,
});
beforeEach(async () => {
  await seedPerson(suite.db, { id: "person-1", displayName: "Test person-1" });
});

let db: Database;
beforeAll(() => {
  db = suite.db;
});
const scoped = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(db, fn);
const AT = new Date("2030-10-07T10:00:00Z");
const TUESDAY = 2;

async function venue() {
  await seedVenue(db, {
    name: `Venue ${randomUUID()}`,
    invoiceLocales: ["es-ES"],
    timeZone: "Europe/Madrid",
  });
  const zone = await seedZone(db, { name: "Dining room", displayOrder: 0 });
  return scoped(async (tx) => {
    const departmentId = (await createDepartment(tx, { name: "Restaurant", orderStart: "table" }))
      .id;
    await configureZone(tx, { zoneId: zone!.id, departmentId });
    const period = async (name: string) => {
      const menuId = (await createMenu(tx, { name: `${name}` })).id;
      const { document } = await buildMenuDocument(tx, menuId);
      await publishMenu(tx, menuId, menuDocumentHash(document), "person-1");
      return (await saveMenuPeriod(tx, departmentId, { name, menuId, staffMenuIds: [] })).id;
    };
    return {
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

async function seasonIds(): Promise<Record<string, string>> {
  const rows = await scoped((tx) => readSeasons(tx));
  return Object.fromEntries(
    rows.map((season) => [englishSeasonName(season.name, "es"), season.id]),
  );
}
async function departmentTuesdays(v: Venue): Promise<Record<string, ServiceRange[]>> {
  const ids = await seasonIds();
  const weeks = await scoped((tx) => readDepartmentSeasonWeeks(tx, [v.departmentId]));
  const own = weeks.get(v.departmentId);
  return Object.fromEntries(
    Object.entries(ids).map(([name, id]) => [name, own?.get(id)?.[TUESDAY] ?? []]),
  );
}
async function zoneTuesdays(v: Venue) {
  const ids = await seasonIds();
  const weeks = await scoped((tx) => readZoneSeasonWeeks(tx, [v.zoneId]));
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

it("saves and reads opening hours up to both off-quarter changeover edges", async () => {
  const v = await venue();
  await seedBusinessDay(db, { dayCutover: "05:50:00" });
  const ranges = [
    { periodId: v.lunch, startsAt: "05:50", endsAt: "06:00" },
    { periodId: v.dinner, startsAt: "05:45", endsAt: "05:50" },
  ];
  await scoped((tx) => replaceMenuWeek(tx, v.departmentId, menuWeek(ranges), AT, 1));
  expect(await departmentTuesdays(v)).toEqual(everySeason(ranges));
});

it("a saved empty zone week and an unsaved week give the same hours, guides and season split", async () => {
  const v = await venue();
  const other = await seedZone(db, { name: "Second room", displayOrder: 1 });
  const stationId = await seedKitchenStation(db, { name: "Kitchen" });
  await scoped(async (tx) => {
    await configureZone(tx, { zoneId: other!.id, departmentId: v.departmentId });
    const [period] = await tx.select().from(menuPeriods).where(eq(menuPeriods.id, v.lunch));
    const categoryId = (await createCategory(tx, { name: "Meals" })).id;
    const productId = (
      await createProduct(tx, {
        name: "Lunch plate",
        categoryId,
        unitPrice: "10",
        pricingUnit: "each",
        vatClass: "general",
      })
    ).id;
    await addProductToMenu(tx, { menuId: period!.menuId, productId });
    await replaceMenuWeek(
      tx,
      v.departmentId,
      menuWeek([{ periodId: v.lunch, startsAt: "13:00", endsAt: "16:00" }]),
      AT,
      1,
    );
  });
  const { Autumn } = await seasonIds();
  const snapshot = () =>
    scoped(async (tx) => ({
      hours: await readZoneClosedTimes(tx, "06:00"),
      days: await resolveZoneClosedDays(
        tx,
        [v.zoneId, other!.id],
        ["2030-10-08"],
        await readVenueClock(tx),
      ),
      guides: await readPlannedServiceGuides(tx, [stationId], {
        kind: "season",
        seasonId: Autumn!,
        cutover: "06:00",
      }),
    }));
  const unsaved = await snapshot();
  expect(unsaved.guides.stationRanges.get(stationId)?.get("2")).toEqual([
    {
      departmentId: v.departmentId,
      ranges: [{ periodId: v.lunch, startsAt: "13:00", endsAt: "16:00" }],
    },
  ]);
  await scoped((tx) => writeZoneSeasonWeeks(tx, v.zoneId, [Autumn!], [[], [], [], [], [], [], []]));
  expect(await snapshot()).toEqual(unsaved);
  await scoped(async (tx) => {
    const list = await readSeasons(tx);
    const weeks = await readZoneSeasonWeeks(tx);
    expect(seasonWeekList(list, weeks.get(v.zoneId))).toEqual(
      seasonWeekList(list, weeks.get(other!.id)),
    );
    await saveSeasons(
      tx,
      { save: [{ name: "Late autumn", startsOn: "10-15", colour: "grey" }], delete: [] },
      AT,
      1,
    );
    const split = await readSeasons(tx);
    const after = await readZoneSeasonWeeks(tx);
    expect(seasonWeekList(split, after.get(v.zoneId))).toEqual(
      seasonWeekList(split, after.get(other!.id)),
    );
  });
  const split = await snapshot();
  await scoped((tx) =>
    replaceZoneClosedWeek(tx, other!.id, closedWeek([]), 1, AT, { seasonId: Autumn! }),
  );
  await scoped((tx) =>
    saveSeasonWeeks(tx, Autumn!, { zones: [{ zoneId: v.zoneId, days: closedWeek([]) }] }, AT, 1),
  );
  expect(await snapshot()).toEqual(split);
  await scoped(async (tx) => {
    for (const zoneId of [v.zoneId, other!.id])
      await writeZoneSeasonWeeks(
        tx,
        zoneId,
        [Autumn!],
        [[], [], [{ startsAt: "13:00", endsAt: "16:00" }], [], [], [], []],
      );
  });
  const closed = await snapshot();
  expect(closed.days.get(v.zoneId)?.get("2030-10-08")).toEqual([
    { startsAt: "13:00", endsAt: "16:00" },
  ]);
  expect(closed.guides.stationRanges.get(stationId)?.get("2")).toEqual([]);
});

it.each(["saved empty", "last period deleted"] as const)(
  "a department week %s gives the same public answers as a week never saved",
  async (state) => {
    const v = await venue();
    const seasonList = await scoped((tx) => ensureDefaultSeasons(tx));
    const autumn = seasonList.find((season) => season.startsOn === "09-01")!;
    const snapshot = () =>
      scoped(async (tx) => {
        const clock = await readVenueClock(tx);
        const model = await readOpeningHoursModel(tx, AT);
        return {
          weeks: model.departments.find((entry) => entry.id === v.departmentId)!.seasonWeeks,
          days: await resolveDepartmentDays(tx, v.departmentId, ["2030-10-08"], clock),
          guides: (
            await readPlannedServiceGuides(tx, [], {
              kind: "season",
              seasonId: autumn.id,
              cutover: "06:00",
            })
          ).departmentRanges,
          routing: await readRoutingPeriods(tx, "06:00"),
          readiness: await listVenueReadiness(tx, AT),
          closures: await zoneClosureDays(tx, [v.zoneId], AT),
          changed: (await stageMenuWeek(tx, v.departmentId, menuWeek([]), clock, autumn.id))
            .changed,
        };
      });
    const unsaved = await snapshot();
    expect(unsaved.days.get("2030-10-08")!.ranges).toEqual([]);
    expect(unsaved.changed).toBe(false);
    if (state === "saved empty") {
      await scoped((tx) =>
        writeDepartmentSeasonWeeks(tx, v.departmentId, [autumn.id], [[], [], [], [], [], [], []]),
      );
    } else {
      const temporary = await scoped(async (tx) => {
        const [lunch] = await tx.select().from(menuPeriods).where(eq(menuPeriods.id, v.lunch));
        return (
          await saveMenuPeriod(tx, v.departmentId, {
            name: "Temporary",
            menuId: lunch!.menuId,
            staffMenuIds: [],
          })
        ).id;
      });
      await scoped((tx) =>
        writeDepartmentSeasonWeeks(
          tx,
          v.departmentId,
          [autumn.id],
          [[], [], [{ periodId: temporary, startsAt: "13:00", endsAt: "16:00" }], [], [], [], []],
        ),
      );
      expect((await snapshot()).days.get("2030-10-08")!.ranges).toEqual([
        { periodId: temporary, startsAt: "13:00", endsAt: "16:00" },
      ]);
      await scoped((tx) => deletePeriod(tx, temporary, null, AT, 1));
    }
    expect(await snapshot()).toEqual(unsaved);
    await scoped((tx) =>
      saveSeasons(
        tx,
        {
          save: [{ name: "Late autumn", startsOn: "10-15", colour: "grey" }],
          delete: [],
        },
        AT,
        1,
      ),
    );
    const afterSplit = await snapshot();
    expect(afterSplit.weeks).toHaveLength(5);
    for (const season of afterSplit.weeks) expect(season.week).toEqual(menuWeek([]));
    expect(afterSplit.days).toEqual(unsaved.days);
    expect(afterSplit.readiness).toEqual(unsaved.readiness);
  },
);

it("a department week writes one opening_hours row per range and none for empty days", async () => {
  const v = await venue();
  const list = await scoped((tx) => ensureDefaultSeasons(tx));
  const seasonId = list[0]!.id;
  await scoped((tx) =>
    writeDepartmentSeasonWeeks(
      tx,
      v.departmentId,
      [seasonId],
      [[], [], [{ periodId: v.lunch, startsAt: "13:00", endsAt: "16:00" }], [], [], [], []],
    ),
  );
  expect(
    await db
      .select({
        departmentId: openingHours.departmentId,
        zoneId: openingHours.zoneId,
        seasonId: openingHours.seasonId,
        weekday: openingHours.weekday,
        kind: openingHours.kind,
        periodId: openingHours.periodId,
        startsAt: openingHours.startsAt,
        endsAt: openingHours.endsAt,
      })
      .from(openingHours),
  ).toEqual([
    {
      departmentId: v.departmentId,
      zoneId: null,
      seasonId,
      weekday: 2,
      kind: "period",
      periodId: v.lunch,
      startsAt: "13:00:00",
      endsAt: "16:00:00",
    },
  ]);
  await scoped((tx) =>
    writeDepartmentSeasonWeeks(tx, v.departmentId, [seasonId], [[], [], [], [], [], [], []]),
  );
  expect(await db.select().from(openingHours)).toEqual([]);
});

it("writes all ranges when a department's season weeks exceed one statement's bound values", async () => {
  const v = await venue();
  await db.delete(seasons);
  const seasonRows = Array.from({ length: 300 }, (_, day) => ({
    id: randomUUID(),
    name: `Season ${day}`,
    startsOn: new Date(Date.UTC(2025, 0, day + 1)).toISOString().slice(5, 10),
  }));
  await scoped(async (tx) => {
    await insertInChunks(tx, seasons, seasonRows);
    await writeDepartmentSeasonWeeks(
      tx,
      v.departmentId,
      seasonRows.map(({ id }) => id),
      Array.from({ length: 7 }, () => [
        { periodId: v.lunch, startsAt: "12:00", endsAt: "14:00" },
        { periodId: v.dinner, startsAt: "14:00", endsAt: "16:00" },
      ]),
    );
  });
  const rows = await db.select().from(openingHours);
  expect(rows).toHaveLength(4200);
  for (const season of seasonRows) {
    const own = rows.filter((row) => row.seasonId === season.id);
    expect(own).toHaveLength(14);
    expect(own.filter((row) => row.periodId === v.lunch)).toHaveLength(7);
    expect(own.filter((row) => row.periodId === v.dinner)).toHaveLength(7);
  }
});

describe("replaceMenuWeek writes season weeks", () => {
  it("with no season named, gives a venue without seasons its four and paints every one, and the model's current season week holds it", async () => {
    const v = await venue();
    expect(await scoped((tx) => readSeasons(tx))).toEqual([]);
    const lunch = { periodId: v.lunch, startsAt: "13:00", endsAt: "16:00" };
    await scoped((tx) => replaceMenuWeek(tx, v.departmentId, menuWeek([lunch]), AT, 1));
    expect(Object.keys(await seasonIds())).toEqual(["Spring", "Summer", "Autumn", "Winter"]);
    expect(await departmentTuesdays(v)).toEqual(everySeason([lunch]));
    const weeks = await scoped((tx) => readDepartmentSeasonWeeks(tx, [v.departmentId]));
    for (const week of weeks.get(v.departmentId)!.values())
      expect(week).toEqual([[], [], [lunch], [], [], [], []]);
    const model = await scoped((tx) => readOpeningHoursModel(tx, AT));
    expect(model.currentSeasonId).toBe((await seasonIds()).Autumn);
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
    await scoped((tx) => replaceMenuWeek(tx, v.departmentId, menuWeek([lunch]), AT, 1));
    const { Winter } = await seasonIds();
    await scoped((tx) =>
      replaceMenuWeek(tx, v.departmentId, menuWeek([dinner]), AT, 1, {
        seasonId: Winter!,
      }),
    );
    expect(await departmentTuesdays(v)).toEqual({
      Spring: [lunch],
      Summer: [lunch],
      Autumn: [lunch],
      Winter: [dinner],
    });
    const model = await scoped((tx) => readOpeningHoursModel(tx, AT));
    expect(model.currentSeasonId).toBe((await seasonIds()).Autumn);
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
    await scoped((tx) => replaceMenuWeek(tx, v.departmentId, menuWeek([lunch]), AT, 1));
    const { Winter } = await seasonIds();
    await scoped((tx) =>
      replaceMenuWeek(tx, v.departmentId, menuWeek([dinner]), AT, 1, {
        seasonId: Winter!,
      }),
    );
    await expect(
      scoped((tx) => replaceMenuWeek(tx, v.departmentId, menuWeek([lunch]), AT, 6)),
    ).rejects.toMatchObject({ code: "hours.clock_changed" });
    expect((await departmentTuesdays(v)).Winter).toEqual([dinner]);
    await scoped((tx) => replaceMenuWeek(tx, v.departmentId, menuWeek([lunch]), AT, 1));
    expect(await departmentTuesdays(v)).toEqual(everySeason([lunch]));
    await expect(
      scoped((tx) => replaceMenuWeek(tx, v.departmentId, menuWeek([lunch]), AT, 6)),
    ).resolves.toBeUndefined();
  });

  it("counts an unchanged week as no time change when a season stores it as touching ranges of one period, as an import may", async () => {
    const v = await venue();
    const split = [
      { periodId: v.lunch, startsAt: "13:00", endsAt: "14:00" },
      { periodId: v.lunch, startsAt: "14:00", endsAt: "16:00" },
    ];
    await scoped((tx) => replaceMenuWeek(tx, v.departmentId, menuWeek(split), AT, 1));
    const stored = [0, 1, 2, 3, 4, 5, 6].map((weekday) => (weekday === TUESDAY ? split : []));
    for (const seasonId of Object.values(await seasonIds()))
      await scoped((tx) => writeDepartmentSeasonWeeks(tx, v.departmentId, [seasonId], stored));
    expect(await departmentTuesdays(v)).toEqual(everySeason(split));
    await expect(
      scoped((tx) => replaceMenuWeek(tx, v.departmentId, menuWeek(split), AT, 6)),
    ).resolves.toBeUndefined();
  });

  it("joins touching ranges of one period, and keeps touching ranges of two periods apart", async () => {
    const v = await venue();
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.departmentId,
        menuWeek([
          { periodId: v.lunch, startsAt: "14:00", endsAt: "16:00" },
          { periodId: v.lunch, startsAt: "13:00", endsAt: "14:00" },
          { periodId: v.dinner, startsAt: "16:00", endsAt: "18:00" },
        ]),
        AT,
        1,
      ),
    );
    expect(await departmentTuesdays(v)).toEqual(
      everySeason([
        { periodId: v.lunch, startsAt: "13:00", endsAt: "16:00" },
        { periodId: v.dinner, startsAt: "16:00", endsAt: "18:00" },
      ]),
    );
  });

  it("refuses a season it does not know, writing nothing", async () => {
    const v = await venue();
    const seasonId = randomUUID();
    await expect(
      scoped((tx) =>
        replaceMenuWeek(
          tx,
          v.departmentId,
          menuWeek([{ periodId: v.lunch, startsAt: "13:00", endsAt: "16:00" }]),
          AT,
          1,
          { seasonId },
        ),
      ),
    ).rejects.toMatchObject({ code: "season.not_found", params: { seasonId } });
    expect(await scoped((tx) => readSeasons(tx))).toEqual([]);
  });

  it("never writes a Closed range into a season week", async () => {
    const v = await venue();
    await expect(
      scoped((tx) =>
        replaceMenuWeek(
          tx,
          v.departmentId,
          menuWeek([{ periodId: null as unknown as string, startsAt: "13:00", endsAt: "16:00" }]),
          AT,
          1,
        ),
      ),
    ).rejects.toMatchObject({ code: "menu_timetable.invalid" });
    await scoped((tx) => replaceMenuWeek(tx, v.departmentId, menuWeek([]), AT, 1));
    const { Winter } = await seasonIds();
    const week = [0, 1, 2, 3, 4, 5, 6].map((weekday) =>
      weekday === TUESDAY
        ? [{ periodId: null as unknown as string, startsAt: "13:00", endsAt: "16:00" }]
        : [],
    );
    await expect(
      scoped((tx) => writeDepartmentSeasonWeeks(tx, v.departmentId, [Winter!], week)),
    ).rejects.toThrow("a season week takes periods only");
    expect(await db.select().from(openingHours)).not.toContainEqual(
      expect.objectContaining({ departmentId: v.departmentId }),
    );
  });
});

describe("replaceZoneClosedWeek writes season weeks", () => {
  it("with no season named, gives a venue without seasons its four and closes every one, and the zone's read shows each season's week", async () => {
    const v = await venue();
    const night = { startsAt: "23:00", endsAt: "02:00" };
    await scoped((tx) => replaceZoneClosedWeek(tx, v.zoneId, closedWeek([night]), 1, AT));
    expect(Object.keys(await seasonIds())).toEqual(["Spring", "Summer", "Autumn", "Winter"]);
    expect(await zoneTuesdays(v)).toEqual(everySeason([night]));
    const { Autumn } = await seasonIds();
    const [zone] = await scoped((tx) => readZoneClosedTimes(tx, "06:00"));
    expect(zone!.seasonWeeks.find((s) => s.seasonId === Autumn)!.week[TUESDAY]!.ranges).toEqual([
      night,
    ]);
  });

  it("with a season named, changes that season alone, and the zone's read shows each season's week", async () => {
    const v = await venue();
    const night = { startsAt: "23:00", endsAt: "02:00" };
    const afternoon = { startsAt: "16:00", endsAt: "19:00" };
    await scoped((tx) => replaceZoneClosedWeek(tx, v.zoneId, closedWeek([night]), 1, AT));
    const { Winter } = await seasonIds();
    await scoped((tx) =>
      replaceZoneClosedWeek(tx, v.zoneId, closedWeek([afternoon]), 1, AT, {
        seasonId: Winter!,
      }),
    );
    expect(await zoneTuesdays(v)).toEqual({
      Spring: [night],
      Summer: [night],
      Autumn: [night],
      Winter: [afternoon],
    });
    const [winterZone] = await scoped((tx) => readZoneClosedTimes(tx, "06:00"));
    expect(
      winterZone!.seasonWeeks.find((s) => s.seasonId === Winter)!.week[TUESDAY]!.ranges,
    ).toEqual([afternoon]);
    const { Autumn } = await seasonIds();
    const [zone] = await scoped((tx) => readZoneClosedTimes(tx, "06:00"));
    expect(zone!.seasonWeeks.find((s) => s.seasonId === Autumn)!.week[TUESDAY]!.ranges).toEqual([
      night,
    ]);
  });

  it("with no season named, counts a season's differing week as a time change, so a stale clock revision is refused", async () => {
    const v = await venue();
    const night = { startsAt: "23:00", endsAt: "02:00" };
    const afternoon = { startsAt: "16:00", endsAt: "19:00" };
    await scoped((tx) => replaceZoneClosedWeek(tx, v.zoneId, closedWeek([night]), 1, AT));
    const { Winter } = await seasonIds();
    await scoped((tx) =>
      replaceZoneClosedWeek(tx, v.zoneId, closedWeek([afternoon]), 1, AT, {
        seasonId: Winter!,
      }),
    );
    await expect(
      scoped((tx) => replaceZoneClosedWeek(tx, v.zoneId, closedWeek([night]), 6, AT)),
    ).rejects.toMatchObject({ code: "hours.clock_changed" });
    expect((await zoneTuesdays(v)).Winter).toEqual([afternoon]);
    await scoped((tx) => replaceZoneClosedWeek(tx, v.zoneId, closedWeek([night]), 1, AT));
    expect(await zoneTuesdays(v)).toEqual(everySeason([night]));
    await expect(
      scoped((tx) => replaceZoneClosedWeek(tx, v.zoneId, closedWeek([night]), 6, AT)),
    ).resolves.toBeUndefined();
  });

  it("counts an unchanged week as no time change when a season stores it as touching ranges, as an import may", async () => {
    const v = await venue();
    const split = [
      { startsAt: "13:00", endsAt: "14:00" },
      { startsAt: "14:00", endsAt: "16:00" },
    ];
    await scoped((tx) => replaceZoneClosedWeek(tx, v.zoneId, closedWeek(split), 1, AT));
    const stored = [0, 1, 2, 3, 4, 5, 6].map((weekday) => (weekday === TUESDAY ? split : []));
    for (const seasonId of Object.values(await seasonIds()))
      await scoped((tx) => writeZoneSeasonWeeks(tx, v.zoneId, [seasonId], stored));
    expect(await zoneTuesdays(v)).toEqual(everySeason(split));
    await expect(
      scoped((tx) => replaceZoneClosedWeek(tx, v.zoneId, closedWeek(split), 6, AT)),
    ).resolves.toBeUndefined();
  });

  it("joins touching closed ranges", async () => {
    const v = await venue();
    await scoped((tx) =>
      replaceZoneClosedWeek(
        tx,
        v.zoneId,
        closedWeek([
          { startsAt: "14:00", endsAt: "16:00" },
          { startsAt: "13:00", endsAt: "14:00" },
        ]),
        1,
        AT,
      ),
    );
    expect(await zoneTuesdays(v)).toEqual(everySeason([{ startsAt: "13:00", endsAt: "16:00" }]));
  });

  it("refuses a season it does not know, writing nothing", async () => {
    const v = await venue();
    const seasonId = randomUUID();
    await expect(
      scoped((tx) =>
        replaceZoneClosedWeek(
          tx,
          v.zoneId,
          closedWeek([{ startsAt: "13:00", endsAt: "16:00" }]),
          1,
          AT,
          { seasonId },
        ),
      ),
    ).rejects.toMatchObject({ code: "season.not_found", params: { seasonId } });
    expect(await scoped((tx) => readSeasons(tx))).toEqual([]);
  });

  it("writes every season range as closed, whatever kind it is handed", async () => {
    const v = await venue();
    await scoped((tx) => replaceZoneClosedWeek(tx, v.zoneId, closedWeek([]), 1, AT));
    const { Winter } = await seasonIds();
    const week = [0, 1, 2, 3, 4, 5, 6].map((weekday) =>
      weekday === TUESDAY ? [{ startsAt: "13:00", endsAt: "16:00", kind: "open" }] : [],
    );
    await scoped((tx) => writeZoneSeasonWeeks(tx, v.zoneId, [Winter!], week));
    const kinds = await db
      .select({ kind: openingHours.kind })
      .from(openingHours)
      .where(eq(openingHours.zoneId, v.zoneId));
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
const zoneWrites = (texts: readonly string[]) => ({
  deletes: texts.filter((text) => text.startsWith('delete from "opening_hours"')).length,
  inserts: texts.filter((text) => text.startsWith('insert into "opening_hours"')).length,
});
const ONE_WRITE = { deletes: 1, inserts: 1 };
const NO_WRITE = { deletes: 0, inserts: 0 };

describe("week writes", () => {
  it("writes every season's department week in one delete and one insert, and leaves a season already holding the week alone", async () => {
    const v = await venue();
    const lunch = { periodId: v.lunch, startsAt: "13:00", endsAt: "16:00" };
    const dinner = { periodId: v.dinner, startsAt: "20:00", endsAt: "23:00" };
    const save = (tuesday: ServiceRange[], seasonId?: string) =>
      statementsOf((tx) =>
        replaceMenuWeek(tx, v.departmentId, menuWeek(tuesday), AT, 1, { seasonId }),
      );
    const rows = async () => {
      const names = Object.fromEntries(
        Object.entries(await seasonIds()).map(([name, id]) => [id, name]),
      );
      const found = await db
        .select({ id: openingHours.id, seasonId: openingHours.seasonId })
        .from(openingHours)
        .where(eq(openingHours.departmentId, v.departmentId));
      const bySeason: Record<string, string[]> = {};
      for (const row of found) (bySeason[names[row.seasonId!]!] ??= []).push(row.id);
      for (const ids of Object.values(bySeason)) ids.sort();
      return bySeason;
    };
    expect(zoneWrites(await save([lunch]))).toEqual(ONE_WRITE);
    const first = await rows();
    expect(zoneWrites(await save([lunch]))).toEqual(NO_WRITE);
    expect(await rows()).toEqual(first);
    const { Winter } = await seasonIds();
    await save([dinner], Winter);
    const winter = (await rows()).Winter;
    expect(zoneWrites(await save([lunch]))).toEqual(ONE_WRITE);
    const after = await rows();
    expect({ ...after, Winter: [] }).toEqual({ ...first, Winter: [] });
    expect(after.Winter).not.toEqual(winter);
    expect(await departmentTuesdays(v)).toEqual(everySeason([lunch]));
  });

  it("writes every season's zone week in one delete and one insert, and leaves a season already holding the week alone", async () => {
    const v = await venue();
    const night = { startsAt: "23:00", endsAt: "02:00" };
    const afternoon = { startsAt: "16:00", endsAt: "19:00" };
    const save = (tuesday: { startsAt: string; endsAt: string }[], seasonId?: string) =>
      statementsOf((tx) =>
        replaceZoneClosedWeek(tx, v.zoneId, closedWeek(tuesday), 1, AT, { seasonId }),
      );
    const rows = async () => {
      const names = Object.fromEntries(
        Object.entries(await seasonIds()).map(([name, id]) => [id, name]),
      );
      const found = await db
        .select({ id: openingHours.id, seasonId: openingHours.seasonId })
        .from(openingHours)
        .where(eq(openingHours.zoneId, v.zoneId));
      const bySeason: Record<string, string[]> = {};
      for (const row of found) (bySeason[names[row.seasonId!]!] ??= []).push(row.id);
      for (const ids of Object.values(bySeason)) ids.sort();
      return bySeason;
    };
    expect(zoneWrites(await save([night]))).toEqual({ deletes: 1, inserts: 1 });
    const first = await rows();
    expect(zoneWrites(await save([night]))).toEqual({ deletes: 0, inserts: 0 });
    expect(await rows()).toEqual(first);
    const { Winter } = await seasonIds();
    await save([afternoon], Winter);
    const winter = (await rows()).Winter;
    expect(zoneWrites(await save([night]))).toEqual({ deletes: 1, inserts: 1 });
    const after = await rows();
    expect({ ...after, Winter: [] }).toEqual({ ...first, Winter: [] });
    expect(after.Winter).not.toEqual(winter);
    expect(await zoneTuesdays(v)).toEqual(everySeason([night]));
    expect(zoneWrites(await save([]))).toEqual({ deletes: 1, inserts: 0 });
    expect(zoneWrites(await save([]))).toEqual({ deletes: 0, inserts: 0 });
    expect(await zoneTuesdays(v)).toEqual(everySeason([]));
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
        v.departmentId,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: weekday === 1 ? [dinner] : weekday === TUESDAY ? [lunch] : [],
        })),
        AT,
        1,
      );
      await replaceZoneClosedWeek(
        tx,
        v.zoneId,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          ranges: weekday === 1 ? [afternoon] : weekday === TUESDAY ? [night] : [],
        })),
        1,
        AT,
      );
    });
    const { Winter } = await seasonIds();
    const only = { seasonIds: [Winter!], weekdays: [TUESDAY] };
    const tuesdayOnly = <T>(range: T) =>
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => (weekday === TUESDAY ? [range] : []));
    const departments = await scoped((tx) =>
      readDepartmentSeasonWeeks(tx, [v.departmentId], "06:00", only),
    );
    expect(departments).toEqual(
      new Map([[v.departmentId, new Map([[Winter!, tuesdayOnly(lunch)]])]]),
    );
    const zones = await scoped((tx) => readZoneSeasonWeeks(tx, [v.zoneId], "06:00", only));
    expect(zones).toEqual(new Map([[v.zoneId, new Map([[Winter!, tuesdayOnly(night)]])]]));
    for (const none of [
      { seasonIds: [], weekdays: [TUESDAY] },
      { seasonIds: [Winter!], weekdays: [] },
    ])
      expect(
        await statementsOf(async (tx) => {
          expect(await readDepartmentSeasonWeeks(tx, [v.departmentId], "06:00", none)).toEqual(
            new Map(),
          );
          expect(await readZoneSeasonWeeks(tx, [v.zoneId], "06:00", none)).toEqual(new Map());
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
        v.departmentId,
        menuWeek([{ periodId: v.lunch, startsAt: "13:00", endsAt: "16:00" }]),
        AT,
        1,
      ),
    );
    const { Winter } = await seasonIds();
    await db.delete(seasons).where(eq(seasons.id, Winter!));
    const weeks = await scoped((tx) => readDepartmentSeasonWeeks(tx, [v.departmentId]));
    expect([...weeks.get(v.departmentId)!.keys()]).not.toContain(Winter);
    expect(weeks.get(v.departmentId)!.size).toBe(3);
  });
});

describe("saveSeasonWeeks", () => {
  const refused =
    (code: string, params: Record<string, unknown>) =>
    (error: { code?: unknown; params?: unknown }) => {
      expect({ code: error.code, params: error.params }).toEqual({ code, params });
      return true;
    };
  async function painted() {
    const v = await venue();
    const lunch = { periodId: v.lunch, startsAt: "13:00", endsAt: "16:00" };
    await scoped((tx) => replaceMenuWeek(tx, v.departmentId, menuWeek([lunch]), AT, 1));
    const more = await scoped(async (tx) => {
      const department = async (name: string) => {
        const id = (await createDepartment(tx, { name, orderStart: "table" })).id;
        const menuId = (await createMenu(tx, { name: `${name}` })).id;
        const { document } = await buildMenuDocument(tx, menuId);
        await publishMenu(tx, menuId, menuDocumentHash(document), "person-1");
        const period = (await saveMenuPeriod(tx, id, { name, menuId, staffMenuIds: [] })).id;
        return { id, period };
      };
      return { terrace: await department("Terrace"), bar: await department("Bar") };
    });
    const bar = { periodId: more.bar.period, startsAt: "18:00", endsAt: "22:00" };
    await scoped((tx) => replaceMenuWeek(tx, more.bar.id, menuWeek([bar]), AT, 1));
    const { Winter } = await seasonIds();
    return { ...v, ...more, lunchRange: lunch, barRange: bar, winter: Winter! };
  }
  const stored = () =>
    scoped(async (tx) => ({
      departments: await readDepartmentSeasonWeeks(tx),
      zones: await readZoneSeasonWeeks(tx),
    }));
  const tuesdays = async (departmentId: string) => {
    const weeks = (await stored()).departments.get(departmentId);
    const ids = await seasonIds();
    return Object.fromEntries(
      Object.entries(ids).map(([name, id]) => [name, weeks?.get(id)?.[TUESDAY] ?? []]),
    );
  };

  it("sparse saves preserve other department and zone weekdays, including a later clear", async () => {
    const p = await painted();
    const dinner = { periodId: p.dinner, startsAt: "20:00", endsAt: "23:00" };
    const closed = { startsAt: "15:00", endsAt: "16:00" };
    await scoped((tx) =>
      saveSeasonWeeks(
        tx,
        p.winter,
        {
          departments: [{ departmentId: p.departmentId, days: [{ weekday: 3, slots: [dinner] }] }],
          zones: [{ zoneId: p.zoneId, days: [{ weekday: 2, ranges: [closed] }] }],
        },
        AT,
        1,
      ),
    );
    await scoped((tx) =>
      saveSeasonWeeks(
        tx,
        p.winter,
        {
          departments: [
            { departmentId: p.departmentId, days: [{ weekday: 4, slots: [p.lunchRange] }] },
          ],
          zones: [{ zoneId: p.zoneId, days: [{ weekday: 3, ranges: [closed] }] }],
        },
        AT,
        1,
      ),
    );
    const first = await stored();
    expect(first.departments.get(p.departmentId)!.get(p.winter)![2]).toEqual([p.lunchRange]);
    expect(first.departments.get(p.departmentId)!.get(p.winter)![3]).toEqual([dinner]);
    expect(first.departments.get(p.departmentId)!.get(p.winter)![4]).toEqual([p.lunchRange]);
    expect(first.zones.get(p.zoneId)!.get(p.winter)![2]).toEqual([closed]);
    expect(first.zones.get(p.zoneId)!.get(p.winter)![3]).toEqual([closed]);
    await scoped((tx) =>
      saveSeasonWeeks(
        tx,
        p.winter,
        {
          departments: [{ departmentId: p.departmentId, days: [{ weekday: 3, slots: [] }] }],
          zones: [{ zoneId: p.zoneId, days: [{ weekday: 2, ranges: [] }] }],
        },
        AT,
        1,
      ),
    );
    const cleared = await stored();
    expect(cleared.departments.get(p.departmentId)!.get(p.winter)![3]).toEqual([]);
    expect(cleared.departments.get(p.departmentId)!.get(p.winter)![4]).toEqual([p.lunchRange]);
    expect(cleared.zones.get(p.zoneId)!.get(p.winter)![2]).toEqual([]);
    expect(cleared.zones.get(p.zoneId)!.get(p.winter)![3]).toEqual([closed]);
    await scoped((tx) =>
      saveSeasonWeeks(
        tx,
        p.winter,
        {
          departments: [{ departmentId: p.departmentId, days: [] }],
          zones: [{ zoneId: p.zoneId, days: [] }],
        },
        AT,
        1,
      ),
    );
    expect(await stored()).toEqual(cleared);
  });

  it.each(["department", "zone"] as const)(
    "sparse %s errors keep sent positions and back out all owners",
    async (owner) => {
      const p = await painted();
      const before = await stored();
      const valid = { departmentId: p.departmentId, days: [{ weekday: 3, slots: [p.lunchRange] }] };
      const badDepartment = {
        departmentId: p.terrace.id,
        days: [{ weekday: 6, slots: [{ periodId: p.lunch, startsAt: "13:00", endsAt: "16:00" }] }],
      };
      const badZone = {
        zoneId: p.zoneId,
        days: [{ weekday: 6, ranges: [{ startsAt: "16:00", endsAt: "16:00" }] }],
      };
      await expect(
        scoped((tx) =>
          saveSeasonWeeks(
            tx,
            p.winter,
            {
              departments: owner === "department" ? [valid, badDepartment] : [valid],
              ...(owner === "zone" ? { zones: [badZone] } : {}),
            },
            AT,
            1,
          ),
        ),
      ).rejects.toMatchObject({
        code: owner === "department" ? "menu_timetable.invalid" : "zone_closed_time.invalid",
        params: {
          field:
            owner === "department"
              ? "departments.1.days.0.slots.0.periodId"
              : "zones.0.days.0.ranges",
        },
      });
      expect(await stored()).toEqual(before);
    },
  );

  it.each(["department", "zone"] as const)(
    "sparse %s rejects duplicate and invalid weekday keys",
    async (owner) => {
      const p = await painted();
      const before = await stored();
      for (const weekdays of [
        [3, 3],
        [3, 7],
        [3, 1.5],
      ]) {
        const days = weekdays.map((weekday) => ({ weekday, slots: [], ranges: [] }));
        await expect(
          scoped((tx) =>
            saveSeasonWeeks(
              tx,
              p.winter,
              owner === "department"
                ? { departments: [{ departmentId: p.departmentId, days }] }
                : { zones: [{ zoneId: p.zoneId, days }] },
              AT,
              1,
            ),
          ),
        ).rejects.toMatchObject({
          code: owner === "department" ? "menu_timetable.invalid" : "zone_closed_time.invalid",
          params: { field: `${owner === "department" ? "departments" : "zones"}.0.days.1.weekday` },
        });
        expect(await stored()).toEqual(before);
      }
    },
  );

  it("saves two departments' weeks and a zone's week in the season named, leaving other seasons and an unlisted department as they were", async () => {
    const p = await painted();
    const dinner = { periodId: p.dinner, startsAt: "20:00", endsAt: "23:00" };
    const terrace = { periodId: p.terrace.period, startsAt: "12:00", endsAt: "15:00" };
    const closed = { startsAt: "16:00", endsAt: "18:00" };
    await scoped((tx) =>
      saveSeasonWeeks(
        tx,
        p.winter,
        {
          departments: [
            { departmentId: p.departmentId, days: menuWeek([dinner]) },
            { departmentId: p.terrace.id, days: menuWeek([terrace]) },
          ],
          zones: [{ zoneId: p.zoneId, days: closedWeek([closed]) }],
        },
        AT,
        1,
      ),
    );
    expect(await tuesdays(p.departmentId)).toEqual({
      ...everySeason([p.lunchRange]),
      Winter: [dinner],
    });
    expect(await tuesdays(p.terrace.id)).toEqual({
      ...everySeason([]),
      Winter: [terrace],
    });
    expect(await tuesdays(p.bar.id)).toEqual(everySeason([p.barRange]));
    expect(await zoneTuesdays(p)).toEqual({ ...everySeason([]), Winter: [closed] });
  });

  it("saves a zone's week alone, leaving every department's week as it was", async () => {
    const p = await painted();
    const before = (await stored()).departments;
    const closed = { startsAt: "16:00", endsAt: "18:00" };
    await scoped((tx) =>
      saveSeasonWeeks(
        tx,
        p.winter,
        { zones: [{ zoneId: p.zoneId, days: closedWeek([closed]) }] },
        AT,
        1,
      ),
    );
    expect((await stored()).departments).toEqual(before);
    expect(await zoneTuesdays(p)).toEqual({ ...everySeason([]), Winter: [closed] });
  });

  it("refuses a changing save under a stale clock revision, writing nothing", async () => {
    const p = await painted();
    const before = await stored();
    const dinner = { periodId: p.dinner, startsAt: "20:00", endsAt: "23:00" };
    await expect(
      scoped((tx) =>
        saveSeasonWeeks(
          tx,
          p.winter,
          {
            departments: [{ departmentId: p.departmentId, days: menuWeek([dinner]) }],
            zones: [
              { zoneId: p.zoneId, days: closedWeek([{ startsAt: "16:00", endsAt: "18:00" }]) },
            ],
          },
          AT,
          6,
        ),
      ),
    ).rejects.toMatchObject({ code: "hours.clock_changed" });
    expect(await stored()).toEqual(before);
  });

  it("checks the revision once over every week, so a zone's change alone makes it a time change", async () => {
    const p = await painted();
    const before = await stored();
    await expect(
      scoped((tx) =>
        saveSeasonWeeks(
          tx,
          p.winter,
          {
            departments: [{ departmentId: p.departmentId, days: menuWeek([p.lunchRange]) }],
            zones: [
              { zoneId: p.zoneId, days: closedWeek([{ startsAt: "16:00", endsAt: "18:00" }]) },
            ],
          },
          AT,
          6,
        ),
      ),
    ).rejects.toMatchObject({ code: "hours.clock_changed" });
    expect(await stored()).toEqual(before);
    await expect(
      scoped((tx) =>
        saveSeasonWeeks(
          tx,
          p.winter,
          { departments: [{ departmentId: p.departmentId, days: menuWeek([p.lunchRange]) }] },
          AT,
          6,
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses a season it does not know, writing nothing", async () => {
    const p = await painted();
    const before = await stored();
    const seasonId = randomUUID();
    for (const input of [
      {},
      { departments: [{ departmentId: p.departmentId, days: menuWeek([]) }] },
    ])
      await expect(
        scoped((tx) => saveSeasonWeeks(tx, seasonId, input, AT, 1)),
      ).rejects.toMatchObject({ code: "season.not_found", params: { seasonId } });
    expect(await stored()).toEqual(before);
  });

  it("refuses an overlap in the second department naming it by its place in the list, and leaves the first department's week as it was", async () => {
    const p = await painted();
    const before = await stored();
    const dinner = { periodId: p.dinner, startsAt: "20:00", endsAt: "23:00" };
    await expect(
      scoped((tx) =>
        saveSeasonWeeks(
          tx,
          p.winter,
          {
            departments: [
              { departmentId: p.departmentId, days: menuWeek([dinner]) },
              {
                departmentId: p.terrace.id,
                days: menuWeek([
                  { periodId: p.terrace.period, startsAt: "12:00", endsAt: "15:00" },
                  { periodId: p.terrace.period, startsAt: "14:00", endsAt: "16:00" },
                ]),
              },
            ],
          },
          AT,
          1,
        ),
      ),
    ).rejects.toSatisfy(
      refused("menu_timetable.invalid", {
        field: `departments.1.days.${TUESDAY}.slots`,
        reason: "overlap",
      }),
    );
    expect(await stored()).toEqual(before);
  });

  it("refuses an overlap in a zone naming it by its place in the list, writing nothing", async () => {
    const p = await painted();
    const before = await stored();
    const dinner = { periodId: p.dinner, startsAt: "20:00", endsAt: "23:00" };
    await expect(
      scoped((tx) =>
        saveSeasonWeeks(
          tx,
          p.winter,
          {
            departments: [{ departmentId: p.departmentId, days: menuWeek([dinner]) }],
            zones: [
              {
                zoneId: p.zoneId,
                days: closedWeek([
                  { startsAt: "16:00", endsAt: "18:00" },
                  { startsAt: "17:00", endsAt: "19:00" },
                ]),
              },
            ],
          },
          AT,
          1,
        ),
      ),
    ).rejects.toSatisfy(
      refused("zone_closed_time.invalid", {
        field: `zones.0.days.${TUESDAY}.ranges`,
        reason: "overlap",
      }),
    );
    expect(await stored()).toEqual(before);
  });

  it("lets a failure that is not a refusal through unchanged, writing nothing", async () => {
    const p = await painted();
    const before = await stored();
    const dinner = { periodId: p.dinner, startsAt: "20:00", endsAt: "23:00" };
    const failure = new TypeError("unreadable day");
    const unreadable = Object.defineProperty({}, "weekday", {
      get() {
        throw failure;
      },
    }) as MenuWeekDay;
    await expect(
      scoped((tx) =>
        saveSeasonWeeks(
          tx,
          p.winter,
          {
            departments: [
              { departmentId: p.departmentId, days: menuWeek([dinner]) },
              { departmentId: p.terrace.id, days: [unreadable, ...menuWeek([]).slice(1)] },
            ],
          },
          AT,
          1,
        ),
      ),
    ).rejects.toBe(failure);
    expect(await stored()).toEqual(before);
  });

  it("refuses an unknown department or zone with the writer's own code, writing nothing", async () => {
    const p = await painted();
    const before = await stored();
    const dinner = { periodId: p.dinner, startsAt: "20:00", endsAt: "23:00" };
    const departmentId = randomUUID();
    await expect(
      scoped((tx) =>
        saveSeasonWeeks(
          tx,
          p.winter,
          {
            departments: [
              { departmentId: p.departmentId, days: menuWeek([dinner]) },
              { departmentId, days: menuWeek([]) },
            ],
          },
          AT,
          1,
        ),
      ),
    ).rejects.toMatchObject({ code: "department.not_found", params: { departmentId } });
    const zoneId = randomUUID();
    await expect(
      scoped((tx) =>
        saveSeasonWeeks(
          tx,
          p.winter,
          {
            departments: [{ departmentId: p.departmentId, days: menuWeek([dinner]) }],
            zones: [{ zoneId, days: closedWeek([]) }],
          },
          AT,
          1,
        ),
      ),
    ).rejects.toMatchObject({ code: "service_zone.not_found" });
    expect(await stored()).toEqual(before);
  });

  it("refuses a department's slot naming another listed department's period, by its place, writing nothing", async () => {
    const p = await painted();
    const before = await stored();
    const terrace = { periodId: p.terrace.period, startsAt: "12:00", endsAt: "15:00" };
    await expect(
      scoped((tx) =>
        saveSeasonWeeks(
          tx,
          p.winter,
          {
            departments: [
              { departmentId: p.terrace.id, days: menuWeek([terrace]) },
              { departmentId: p.bar.id, days: menuWeek([terrace]) },
            ],
          },
          AT,
          1,
        ),
      ),
    ).rejects.toSatisfy(
      refused("menu_timetable.invalid", {
        field: `departments.1.days.${TUESDAY}.slots.0.periodId`,
      }),
    );
    expect(await stored()).toEqual(before);
  });
});
