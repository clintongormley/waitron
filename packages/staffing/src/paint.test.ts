import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  addProductToMenu,
  createCatalogue,
  createCategory,
  createProduct,
  CATALOGUE_MIGRATIONS,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  floorZones,
  catalogues,
  kitchenStations,
  locations,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import {
  VENUE_SERVICE_MIGRATIONS,
  configureZone,
  setRoutingCell,
  zoneDays,
  zoneDayRanges,
  departmentDayRanges,
  departmentDays,
  departments,
  menuPeriods,
  seasons,
  specialDayDates,
  specialDays,
} from "@waitron/venue-service";
import { WORKFORCE_MIGRATIONS } from "@waitron/workforce";
import { AppError, locationId } from "@waitron/shared";
import { seedVenue } from "../test/seed.js";
import { STAFFING_MIGRATIONS } from "./migrations.js";
import {
  listStaffingAreas,
  readSeasonStaffing,
  readSpecialDayStaffing,
  resolveStaffing,
  saveSeasonStaffing,
  saveSpecialDayStaffing,
} from "./paint.js";
import { staffingBlocks, staffingDays, staffRoles } from "./schema/staffing.js";
import type { AreaRef, StaffingBlock } from "./slots.js";

const suite = useVenueDb({
  migrations: [
    CORE_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
    WORKFORCE_MIGRATIONS,
    STAFFING_MIGRATIONS,
  ],
});

const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);

async function refusal(work: Promise<unknown>): Promise<{ code: string; params: unknown }> {
  const error = await work.then(
    () => {
      throw new Error("expected a refusal");
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  const { code, params } = error as AppError;
  return { code, params };
}

/** The seeded venue, with two staff roles, a second station and a special day of two dates. */
async function venue() {
  const v = await seedVenue(suite.db);
  return inTx(async (tx) => {
    const [waiter] = await tx
      .insert(staffRoles)
      .values({ locationId: v.cfg.locationId, name: "Waiter" })
      .returning({ id: staffRoles.id });
    const [cook] = await tx
      .insert(staffRoles)
      .values({ locationId: v.cfg.locationId, name: "Cook", position: 1 })
      .returning({ id: staffRoles.id });
    const [pass] = await tx
      .insert(kitchenStations)
      .values({ locationId: v.cfg.locationId, name: "Pass", displayOrder: 1 })
      .returning({ id: kitchenStations.id });
    await tx
      .update(kitchenStations)
      .set({ displayOrder: 2 })
      .where(eq(kitchenStations.id, v.stationId));
    const [special] = await tx
      .insert(specialDays)
      .values({ locationId: v.cfg.locationId, name: "Fiesta" })
      .returning({ id: specialDays.id });
    const dates = await tx
      .insert(specialDayDates)
      .values([
        { specialDayId: special!.id, locationId: v.cfg.locationId, date: "2026-08-15" },
        { specialDayId: special!.id, locationId: v.cfg.locationId, date: "2026-08-14" },
      ])
      .returning({ id: specialDayDates.id, date: specialDayDates.date });
    return {
      ...v,
      waiter: waiter!.id,
      cook: cook!.id,
      passId: pass!.id,
      specialDayId: special!.id,
      aug14: dates.find((d) => d.date === "2026-08-14")!.id,
      aug15: dates.find((d) => d.date === "2026-08-15")!.id,
    };
  });
}

type Venue = Awaited<ReturnType<typeof venue>>;
const dept = (v: Venue): AreaRef => ({ kind: "department", id: v.departmentId });
const grill = (v: Venue): AreaRef => ({ kind: "station", id: v.stationId });
const block = (staffRoleId: string, over: Partial<StaffingBlock> = {}): StaffingBlock => ({
  staffRoleId,
  headcount: 2,
  startsAt: "12:00",
  endsAt: "16:00",
  ...over,
});
const emptyWeek = () => ({ 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] });

async function switchOff(area: AreaRef, active: boolean) {
  await inTx(async (tx) => {
    if (area.kind === "department")
      await tx.update(departments).set({ active }).where(eq(departments.id, area.id));
    else await tx.update(kitchenStations).set({ active }).where(eq(kitchenStations.id, area.id));
  });
}

describe("listStaffingAreas", () => {
  it("lists active departments, then active stations in display order", async () => {
    const v = await venue();
    expect(await inTx((tx) => listStaffingAreas(tx, v.cfg))).toEqual([
      { area: dept(v), name: "Dining room" },
      { area: { kind: "station", id: v.passId }, name: "Pass" },
      { area: grill(v), name: "Grill" },
    ]);
  });
});

describe("season staffing", () => {
  it("reads back a saved week for a department and a station", async () => {
    const v = await venue();
    const late = block(v.cook, { headcount: 1, startsAt: "20:00", endsAt: "02:00" });
    const early = block(v.waiter, { startsAt: "07:00", endsAt: "11:30" });
    await inTx((tx) =>
      saveSeasonStaffing(tx, v.cfg, v.seasonId, [
        { area: dept(v), weekday: 5, blocks: [late, early] },
        { area: grill(v), weekday: 0, blocks: [block(v.cook)] },
      ]),
    );
    const read = await inTx((tx) => readSeasonStaffing(tx, v.cfg, v.seasonId));
    expect(read.areas).toEqual([
      { area: dept(v), name: "Dining room", weekdays: { ...emptyWeek(), 5: [early, late] } },
      { area: { kind: "station", id: v.passId }, name: "Pass", weekdays: emptyWeek() },
      { area: grill(v), name: "Grill", weekdays: { ...emptyWeek(), 0: [block(v.cook)] } },
    ]);
  });

  it("stores times as HH:MM:00", async () => {
    const v = await venue();
    await inTx((tx) =>
      saveSeasonStaffing(tx, v.cfg, v.seasonId, [
        { area: dept(v), weekday: 1, blocks: [block(v.waiter, { endsAt: "16:45" })] },
      ]),
    );
    const rows = await inTx((tx) =>
      tx
        .select({ startsAt: staffingBlocks.startsAt, endsAt: staffingBlocks.endsAt })
        .from(staffingBlocks)
        .innerJoin(staffingDays, eq(staffingDays.id, staffingBlocks.dayId))
        .where(eq(staffingDays.departmentId, v.departmentId)),
    );
    expect(rows).toEqual([{ startsAt: "12:00:00", endsAt: "16:45:00" }]);
  });

  it("replaces a weekday's blocks and deletes its row when saved empty", async () => {
    const v = await venue();
    const save = (blocks: StaffingBlock[]) =>
      inTx((tx) =>
        saveSeasonStaffing(tx, v.cfg, v.seasonId, [{ area: dept(v), weekday: 2, blocks }]),
      );
    await save([block(v.waiter), block(v.cook)]);
    await save([block(v.cook, { headcount: 3 })]);
    expect(
      (await inTx((tx) => readSeasonStaffing(tx, v.cfg, v.seasonId))).areas[0]!.weekdays[2],
    ).toEqual([block(v.cook, { headcount: 3 })]);
    const days = () =>
      inTx((tx) =>
        tx.select().from(staffingDays).where(eq(staffingDays.departmentId, v.departmentId)),
      );
    const [painted] = await days();
    expect(
      await inTx((tx) =>
        tx.select().from(staffingBlocks).where(eq(staffingBlocks.dayId, painted!.id)),
      ),
    ).toHaveLength(1);
    await save([]);
    expect(await days()).toEqual([]);
    expect(
      await inTx((tx) =>
        tx.select().from(staffingBlocks).where(eq(staffingBlocks.dayId, painted!.id)),
      ),
    ).toEqual([]);
  });

  it("refuses a season at another location, a staff role from another location and an unknown area", async () => {
    const v = await venue();
    const other = await venue();
    expect(await refusal(inTx((tx) => readSeasonStaffing(tx, v.cfg, other.seasonId)))).toEqual({
      code: "season.not_found",
      params: { seasonId: other.seasonId },
    });
    expect(await refusal(inTx((tx) => saveSeasonStaffing(tx, v.cfg, other.seasonId, [])))).toEqual({
      code: "season.not_found",
      params: { seasonId: other.seasonId },
    });
    expect(
      await refusal(
        inTx((tx) =>
          saveSeasonStaffing(tx, v.cfg, v.seasonId, [
            { area: dept(v), weekday: 1, blocks: [block(v.waiter), block(other.cook)] },
          ]),
        ),
      ),
    ).toEqual({ code: "staff_role.not_found", params: { staffRoleId: other.cook } });
    const unknown: AreaRef = { kind: "station", id: randomUUID() };
    expect(
      await refusal(
        inTx((tx) =>
          saveSeasonStaffing(tx, v.cfg, v.seasonId, [
            { area: unknown, weekday: 1, blocks: [block(v.waiter)] },
          ]),
        ),
      ),
    ).toEqual({ code: "staffing_area.not_found", params: { area: `station:${unknown.id}` } });
    const elsewhere: AreaRef = { kind: "department", id: other.departmentId };
    expect(
      await refusal(
        inTx((tx) =>
          saveSeasonStaffing(tx, v.cfg, v.seasonId, [{ area: elsewhere, weekday: 1, blocks: [] }]),
        ),
      ),
    ).toEqual({
      code: "staffing_area.not_found",
      params: { area: `department:${other.departmentId}` },
    });
    expect(
      await inTx((tx) =>
        tx.select().from(staffingDays).where(eq(staffingDays.seasonId, v.seasonId)),
      ),
    ).toEqual([]);
  });

  it("guides each active department with its painted hours per weekday, and a station with none", async () => {
    const v = await venue();
    const [closed] = await inTx((tx) =>
      tx
        .insert(departments)
        .values({ locationId: v.cfg.locationId, name: "Terrace", tradingName: "Terrace" })
        .returning({ id: departments.id }),
    );
    const periodIds = new Map<string, string>();
    await inTx(async (tx) => {
      const menuId = randomUUID();
      await tx.insert(catalogues).values({ id: menuId, name: "Guide menu" });
      for (const [departmentId, weekday, startsAt, endsAt] of [
        [v.departmentId, 3, "19:00:00", "23:30:00"],
        [closed!.id, 3, "10:00:00", "12:00:00"],
      ] as const) {
        const [period] = await tx
          .insert(menuPeriods)
          .values({ departmentId, menuId, name: "Service" })
          .returning({ id: menuPeriods.id });
        periodIds.set(departmentId, period!.id);
        const [day] = await tx
          .insert(departmentDays)
          .values({ departmentId, seasonId: v.seasonId, weekday })
          .returning({ id: departmentDays.id });
        await tx
          .insert(departmentDayRanges)
          .values({ dayId: day!.id, departmentId, periodId: period!.id, startsAt, endsAt });
      }
    });
    await switchOff({ kind: "department", id: closed!.id }, false);
    const { guides } = await inTx((tx) => readSeasonStaffing(tx, v.cfg, v.seasonId));
    expect(guides).toEqual({
      [`department:${v.departmentId}`]: {
        ...emptyWeek(),
        3: [
          {
            ...serviceGuide(v, periodIds.get(v.departmentId)!),
            startsAt: "19:00",
            endsAt: "23:30",
          },
        ],
      },
      [`station:${v.passId}`]: emptyWeek(),
      [`station:${v.stationId}`]: emptyWeek(),
    });
  });

  it("carries the location's changeover and every season at the location, by start", async () => {
    const v = await venue();
    const other = await venue();
    const [winter] = await inTx(async (tx) => {
      await tx
        .update(locations)
        .set({ dayCutover: "03:00:00" })
        .where(eq(locations.id, v.cfg.locationId));
      return tx
        .insert(seasons)
        .values({ locationId: v.cfg.locationId, name: "Winter", startsOn: "01-15" })
        .returning({ id: seasons.id });
    });
    const read = await inTx((tx) => readSeasonStaffing(tx, v.cfg, v.seasonId));
    expect(read.cutover).toBe("03:00");
    expect(read.seasons).toEqual([
      { id: winter!.id, name: "Winter", startsOn: "01-15" },
      { id: v.seasonId, name: "Summer", startsOn: "06-01" },
    ]);
    expect(read.seasons.map((s) => s.id)).not.toContain(other.seasonId);
    expect((await inTx((tx) => readSeasonStaffing(tx, v.cfg, winter!.id))).seasons).toEqual(
      read.seasons,
    );
  });
});

describe("special-day staffing", () => {
  it("reads every date of the special day, null where it follows the season", async () => {
    const v = await venue();
    await inTx((tx) =>
      saveSpecialDayStaffing(tx, v.cfg, v.specialDayId, [
        { area: dept(v), dateId: v.aug15, blocks: [block(v.waiter)] },
        { area: grill(v), dateId: v.aug14, blocks: [] },
      ]),
    );
    const noGuide = { [v.aug14]: [], [v.aug15]: [] };
    expect(await inTx((tx) => readSpecialDayStaffing(tx, v.cfg, v.specialDayId))).toEqual({
      cutover: "06:00",
      name: "Fiesta",
      guides: {
        [`department:${v.departmentId}`]: noGuide,
        [`station:${v.passId}`]: noGuide,
        [`station:${v.stationId}`]: noGuide,
      },
      areas: [
        {
          area: dept(v),
          name: "Dining room",
          dates: [
            { dateId: v.aug14, date: "2026-08-14", blocks: null },
            { dateId: v.aug15, date: "2026-08-15", blocks: [block(v.waiter)] },
          ],
        },
        {
          area: { kind: "station", id: v.passId },
          name: "Pass",
          dates: [
            { dateId: v.aug14, date: "2026-08-14", blocks: null },
            { dateId: v.aug15, date: "2026-08-15", blocks: null },
          ],
        },
        {
          area: grill(v),
          name: "Grill",
          dates: [
            { dateId: v.aug14, date: "2026-08-14", blocks: [] },
            { dateId: v.aug15, date: "2026-08-15", blocks: null },
          ],
        },
      ],
    });
  });

  it("guides each department per date with its hours that day, none on a date closed all day", async () => {
    const v = await venue();
    const periodId = await inTx(async (tx) => {
      const menuId = randomUUID();
      await tx.insert(catalogues).values({ id: menuId, name: "Menu" });
      const [period] = await tx
        .insert(menuPeriods)
        .values({ departmentId: v.departmentId, menuId, name: "Service" })
        .returning({ id: menuPeriods.id });
      const paint = async (
        values: typeof departmentDays.$inferInsert,
        ranges: [periodId: string | null, startsAt: string, endsAt: string][],
      ) => {
        const [day] = await tx
          .insert(departmentDays)
          .values(values)
          .returning({ id: departmentDays.id });
        for (const [periodId, startsAt, endsAt] of ranges)
          await tx
            .insert(departmentDayRanges)
            .values({ dayId: day!.id, departmentId: v.departmentId, periodId, startsAt, endsAt });
      };
      // 2026-08-14 is a Friday (5) and 2026-08-15 a Saturday (6).
      await paint({ departmentId: v.departmentId, seasonId: v.seasonId, weekday: 5 }, [
        [period!.id, "19:00:00", "23:30:00"],
      ]);
      await paint({ departmentId: v.departmentId, seasonId: v.seasonId, weekday: 6 }, [
        [period!.id, "12:00:00", "16:00:00"],
      ]);
      // The special day opens a lunch and closes the season's last hour and a half.
      await paint({ departmentId: v.departmentId, specialDayDateId: v.aug14 }, [
        [period!.id, "12:00:00", "14:00:00"],
        [null, "22:00:00", "23:30:00"],
      ]);
      await tx
        .update(specialDayDates)
        .set({ closedAllDay: true })
        .where(eq(specialDayDates.id, v.aug15));
      return period!.id;
    });
    const { guides } = await inTx((tx) => readSpecialDayStaffing(tx, v.cfg, v.specialDayId));
    expect(guides).toEqual({
      [`department:${v.departmentId}`]: {
        [v.aug14]: [
          { ...serviceGuide(v, periodId), startsAt: "12:00", endsAt: "14:00" },
          { ...serviceGuide(v, periodId), startsAt: "19:00", endsAt: "22:00" },
        ],
        [v.aug15]: [],
      },
      [`station:${v.passId}`]: { [v.aug14]: [], [v.aug15]: [] },
      [`station:${v.stationId}`]: { [v.aug14]: [], [v.aug15]: [] },
    });
  });

  it("carries the location's changeover", async () => {
    const v = await venue();
    await inTx((tx) =>
      tx
        .update(locations)
        .set({ dayCutover: "04:30:00" })
        .where(eq(locations.id, v.cfg.locationId)),
    );
    expect((await inTx((tx) => readSpecialDayStaffing(tx, v.cfg, v.specialDayId))).cutover).toBe(
      "04:30",
    );
  });

  it("guides a date by this special day's own hours when another special day repeats onto it", async () => {
    const v = await venue();
    const periodId = await inTx(async (tx) => {
      const menuId = randomUUID();
      await tx.insert(catalogues).values({ id: menuId, name: "Menu" });
      const [period] = await tx
        .insert(menuPeriods)
        .values({ departmentId: v.departmentId, menuId, name: "Service" })
        .returning({ id: menuPeriods.id });
      const [day] = await tx
        .insert(departmentDays)
        .values({ departmentId: v.departmentId, seasonId: v.seasonId, weekday: 5 })
        .returning({ id: departmentDays.id });
      await tx.insert(departmentDayRanges).values({
        dayId: day!.id,
        departmentId: v.departmentId,
        periodId: period!.id,
        startsAt: "19:00:00",
        endsAt: "23:30:00",
      });
      const [feria] = await tx
        .insert(specialDays)
        .values({ locationId: v.cfg.locationId, name: "Feria", repeatsYearly: true })
        .returning({ id: specialDays.id });
      await tx.insert(specialDayDates).values({
        specialDayId: feria!.id,
        locationId: v.cfg.locationId,
        date: "2025-08-14",
        closedAllDay: true,
      });
      return period!.id;
    });
    const { guides } = await inTx((tx) => readSpecialDayStaffing(tx, v.cfg, v.specialDayId));
    expect(guides[`department:${v.departmentId}`]![v.aug14]).toEqual([
      { ...serviceGuide(v, periodId), startsAt: "19:00", endsAt: "23:30" },
    ]);
  });

  it("batches the own special-day read, predecessor calendar and each guide source", async () => {
    const v = await guideVenue();
    const tables = await inTx(async (tx) => {
      const session = (tx as unknown as { session: { prepareQuery: (...a: never[]) => unknown } })
        .session;
      const prepared = vi.spyOn(session, "prepareQuery");
      try {
        await readSpecialDayStaffing(tx, v.cfg, v.specialDayId);
        return prepared.mock.calls.flatMap((call) =>
          [...(call[0] as { sql: string }).sql.matchAll(/\bfrom "(\w+)"/g)].map(
            (match) => match[1]!,
          ),
        );
      } finally {
        prepared.mockRestore();
      }
    });
    expect(
      Object.fromEntries(
        [
          "special_days",
          "special_day_dates",
          "seasons",
          "staffing_days",
          "department_days",
          "zone_days",
          "menu_periods",
          "products",
          "routing_cells",
        ].map((table) => [table, tables.filter((read) => read === table).length]),
      ),
    ).toEqual({
      special_days: 1,
      special_day_dates: 1,
      seasons: 2,
      staffing_days: 1,
      department_days: 2,
      zone_days: 2,
      menu_periods: 1,
      products: 2,
      routing_cells: 1,
    });
  });

  it("removes a date's row for null blocks and keeps an empty row for []", async () => {
    const v = await venue();
    const save = (blocks: StaffingBlock[] | null) =>
      inTx((tx) =>
        saveSpecialDayStaffing(tx, v.cfg, v.specialDayId, [
          { area: dept(v), dateId: v.aug15, blocks },
        ]),
      );
    const rows = () =>
      inTx((tx) =>
        tx
          .select({ id: staffingDays.id })
          .from(staffingDays)
          .where(eq(staffingDays.specialDayDateId, v.aug15)),
      );
    await save([block(v.waiter)]);
    await save([]);
    expect(await rows()).toHaveLength(1);
    const [{ id }] = (await rows()) as [{ id: string }];
    expect(
      await inTx((tx) => tx.select().from(staffingBlocks).where(eq(staffingBlocks.dayId, id))),
    ).toEqual([]);
    await save(null);
    expect(await rows()).toEqual([]);
  });

  it("refuses a special day elsewhere, a date of another special day, and an unknown staff role", async () => {
    const v = await venue();
    const other = await venue();
    expect(
      await refusal(inTx((tx) => readSpecialDayStaffing(tx, v.cfg, other.specialDayId))),
    ).toEqual({ code: "special_day.not_found", params: { specialDayId: other.specialDayId } });
    expect(
      await refusal(inTx((tx) => saveSpecialDayStaffing(tx, v.cfg, other.specialDayId, []))),
    ).toEqual({ code: "special_day.not_found", params: { specialDayId: other.specialDayId } });
    expect(
      await refusal(
        inTx((tx) =>
          saveSpecialDayStaffing(tx, v.cfg, v.specialDayId, [
            { area: dept(v), dateId: v.aug15, blocks: null },
            { area: dept(v), dateId: other.aug14, blocks: null },
            { area: dept(v), dateId: randomUUID(), blocks: null },
          ]),
        ),
      ),
    ).toEqual({ code: "staffing.invalid", params: { field: "edits.1.dateId" } });
    expect(
      await refusal(
        inTx((tx) =>
          saveSpecialDayStaffing(tx, v.cfg, v.specialDayId, [
            { area: dept(v), dateId: randomUUID(), blocks: null },
          ]),
        ),
      ),
    ).toEqual({ code: "staffing.invalid", params: { field: "edits.0.dateId" } });
    const ghost = randomUUID();
    expect(
      await refusal(
        inTx((tx) =>
          saveSpecialDayStaffing(tx, v.cfg, v.specialDayId, [
            { area: dept(v), dateId: v.aug14, blocks: [block(ghost)] },
          ]),
        ),
      ),
    ).toEqual({ code: "staff_role.not_found", params: { staffRoleId: ghost } });
    expect(
      await refusal(
        inTx((tx) =>
          saveSpecialDayStaffing(tx, v.cfg, v.specialDayId, [
            { area: { kind: "station", id: other.stationId }, dateId: v.aug14, blocks: null },
          ]),
        ),
      ),
    ).toEqual({ code: "staffing_area.not_found", params: { area: `station:${other.stationId}` } });
  });
});

describe("resolveStaffing", () => {
  it("takes the special day's row where there is one, else the season's weekday", async () => {
    const v = await venue();
    // 2026-08-14 is a Friday, 2026-08-15 a Saturday, 2026-08-21 a Friday.
    const friday = [block(v.waiter)];
    const saturday = [block(v.cook, { startsAt: "18:00", endsAt: "23:00" })];
    const fiesta = [block(v.waiter, { headcount: 5 })];
    await inTx(async (tx) => {
      await saveSeasonStaffing(tx, v.cfg, v.seasonId, [
        { area: dept(v), weekday: 5, blocks: friday },
        { area: grill(v), weekday: 5, blocks: saturday },
        { area: dept(v), weekday: 6, blocks: saturday },
      ]);
      await saveSpecialDayStaffing(tx, v.cfg, v.specialDayId, [
        { area: dept(v), dateId: v.aug14, blocks: fiesta },
        { area: dept(v), dateId: v.aug15, blocks: [] },
      ]);
    });
    const resolved = await inTx((tx) =>
      resolveStaffing(tx, v.cfg, ["2026-08-14", "2026-08-15", "2026-08-21", "2026-08-17"]),
    );
    const plain = (day: string) => Object.fromEntries(resolved.get(day)!);
    expect([...resolved.keys()]).toEqual(["2026-08-14", "2026-08-15", "2026-08-21", "2026-08-17"]);
    expect(plain("2026-08-14")).toEqual({
      [`department:${v.departmentId}`]: fiesta,
      [`station:${v.stationId}`]: saturday,
    });
    expect(plain("2026-08-15")).toEqual({ [`department:${v.departmentId}`]: [] });
    expect(plain("2026-08-21")).toEqual({
      [`department:${v.departmentId}`]: friday,
      [`station:${v.stationId}`]: saturday,
    });
    expect(plain("2026-08-17")).toEqual({});
  });

  it("carries a yearly special day's paint to its later years", async () => {
    const v = await venue();
    const fiesta = [block(v.waiter, { headcount: 4 })];
    await inTx(async (tx) => {
      await tx
        .update(specialDays)
        .set({ repeatsYearly: true })
        .where(eq(specialDays.id, v.specialDayId));
      await saveSeasonStaffing(tx, v.cfg, v.seasonId, [
        { area: dept(v), weekday: 0, blocks: [block(v.cook)] },
      ]);
      await saveSpecialDayStaffing(tx, v.cfg, v.specialDayId, [
        { area: dept(v), dateId: v.aug15, blocks: fiesta },
      ]);
    });
    // 2027-08-15 is a Sunday: without the special day it would take the season's Sunday.
    const resolved = await inTx((tx) => resolveStaffing(tx, v.cfg, ["2027-08-15"]));
    expect(Object.fromEntries(resolved.get("2027-08-15")!)).toEqual({
      [`department:${v.departmentId}`]: fiesta,
    });
  });

  it("refuses a given day plan that leaves out an asked day", async () => {
    const v = await venue();
    const plan = {
      seasonIdOn: new Map([["2026-08-14", v.seasonId]]),
      special: new Map([["2026-08-14", null]]),
    };
    await expect(
      inTx((tx) => resolveStaffing(tx, v.cfg, ["2026-08-14", "2026-08-15"], { plan })),
    ).rejects.toThrow("the day plan does not cover 2026-08-15");
    plan.special.delete("2026-08-14");
    await expect(
      inTx((tx) => resolveStaffing(tx, v.cfg, ["2026-08-14"], { plan })),
    ).rejects.toThrow("the day plan does not cover 2026-08-14");
  });

  it("returns empty days when there are no days or no season", async () => {
    const v = await venue();
    expect(await inTx((tx) => resolveStaffing(tx, v.cfg, []))).toEqual(new Map());
    await inTx((tx) => tx.delete(seasons).where(eq(seasons.id, v.seasonId)));
    expect(await inTx((tx) => resolveStaffing(tx, v.cfg, ["2026-08-17"]))).toEqual(
      new Map([["2026-08-17", new Map()]]),
    );
  });
});

describe("switched-off areas", () => {
  it.each(["department", "station"] as const)(
    "a switched-off %s disappears from every read and save, and comes back unchanged",
    async (kind) => {
      const v = await venue();
      const area = kind === "department" ? dept(v) : grill(v);
      const blocks = [block(v.cook)];
      await inTx(async (tx) => {
        await saveSeasonStaffing(tx, v.cfg, v.seasonId, [{ area, weekday: 5, blocks }]);
        await saveSpecialDayStaffing(tx, v.cfg, v.specialDayId, [
          { area, dateId: v.aug15, blocks },
        ]);
      });
      const reads = () =>
        inTx(async (tx) => ({
          areas: (await listStaffingAreas(tx, v.cfg)).map((a) => a.area),
          season: await readSeasonStaffing(tx, v.cfg, v.seasonId),
          special: await readSpecialDayStaffing(tx, v.cfg, v.specialDayId),
          resolved: await resolveStaffing(tx, v.cfg, ["2026-08-14", "2026-08-15"]),
        }));
      const before = await reads();
      await switchOff(area, false);
      const off = await reads();
      expect(off.areas).not.toContainEqual(area);
      expect(off.season.areas.map((a) => a.area)).not.toContainEqual(area);
      expect(Object.keys(off.season.guides)).not.toContain(`${kind}:${area.id}`);
      expect(off.special.areas.map((a) => a.area)).not.toContainEqual(area);
      for (const day of off.resolved.values()) expect(day.has(`${kind}:${area.id}`)).toBe(false);
      expect(
        await refusal(
          inTx((tx) =>
            saveSeasonStaffing(tx, v.cfg, v.seasonId, [{ area, weekday: 5, blocks: [] }]),
          ),
        ),
      ).toEqual({ code: "staffing_area.not_found", params: { area: `${kind}:${area.id}` } });
      expect(
        await refusal(
          inTx((tx) =>
            saveSpecialDayStaffing(tx, v.cfg, v.specialDayId, [
              { area, dateId: v.aug15, blocks: null },
            ]),
          ),
        ),
      ).toEqual({ code: "staffing_area.not_found", params: { area: `${kind}:${area.id}` } });
      await switchOff(area, true);
      expect(await reads()).toEqual(before);
      expect(before.resolved.get("2026-08-14")!.get(`${kind}:${area.id}`)).toEqual(blocks);
    },
  );
});

describe("location clock", () => {
  it("orders blocks of one start by their end, then staff role, then headcount", async () => {
    const v = await venue();
    const [first, second] = [v.waiter, v.cook].sort();
    const ordered = [
      block(second!, { endsAt: "13:00" }),
      block(first!, { headcount: 1 }),
      block(first!, { headcount: 3 }),
      block(second!),
    ];
    await inTx((tx) =>
      saveSeasonStaffing(tx, v.cfg, v.seasonId, [
        { area: dept(v), weekday: 4, blocks: [...ordered].reverse() },
      ]),
    );
    expect(
      (await inTx((tx) => readSeasonStaffing(tx, v.cfg, v.seasonId))).areas[0]!.weekdays[4],
    ).toEqual(ordered);
  });

  it("orders blocks from the location's changeover", async () => {
    const v = await venue();
    await inTx((tx) =>
      tx
        .update(locations)
        .set({ dayCutover: "03:00:00" })
        .where(eq(locations.id, v.cfg.locationId)),
    );
    const night = block(v.cook, { startsAt: "02:00", endsAt: "03:00" });
    const morning = block(v.cook, { startsAt: "04:00", endsAt: "05:00" });
    await inTx((tx) =>
      saveSeasonStaffing(tx, v.cfg, v.seasonId, [
        { area: dept(v), weekday: 1, blocks: [night, morning] },
      ]),
    );
    expect(
      (await inTx((tx) => readSeasonStaffing(tx, v.cfg, v.seasonId))).areas[0]!.weekdays[1],
    ).toEqual([morning, night]);
  });
});

async function guideVenue() {
  const v = await venue();
  return inTx(async (tx) => {
    const cfg = { locationId: locationId(v.cfg.locationId) };
    const menuId = (await createCatalogue(tx, { name: randomUUID() })).id;
    const categoryId = (await createCategory(tx, { name: randomUUID() })).id;
    const productId = (
      await createProduct(tx, {
        catalogueId: menuId,
        name: randomUUID(),
        categoryId,
        unitPrice: "4",
        pricingUnit: "each",
        vatClass: "general",
      })
    ).id;
    await addProductToMenu(tx, { menuId, productId });
    const [zone] = await tx
      .insert(floorZones)
      .values({ ...cfg, name: "Dining" })
      .returning();
    await configureZone(tx, cfg, { zoneId: zone!.id, departmentId: v.departmentId });
    const [period] = await tx
      .insert(menuPeriods)
      .values({
        departmentId: v.departmentId,
        menuId,
        name: "Lunch",
        colour: "blue",
        endOffsetMinutes: -30,
      })
      .returning();
    const [day] = await tx
      .insert(departmentDays)
      .values({ departmentId: v.departmentId, seasonId: v.seasonId, weekday: 5 })
      .returning();
    await tx.insert(departmentDayRanges).values({
      dayId: day!.id,
      departmentId: v.departmentId,
      periodId: period!.id,
      startsAt: "12:00:00",
      endsAt: "16:00:00",
    });
    await setRoutingCell(
      tx,
      cfg,
      { row: { kind: "all" }, zoneId: zone!.id },
      { kind: "station", stationId: v.stationId },
    );
    return { ...v, periodId: period!.id, zoneId: zone!.id, menuId };
  });
}
const lunchGuide = (v: Awaited<ReturnType<typeof guideVenue>>, endsAt = "16:00") => ({
  periodId: v.periodId,
  periodName: "Lunch",
  periodColour: "blue",
  departmentId: v.departmentId,
  departmentName: "Dining room",
  startsAt: "12:00",
  endsAt,
});

it("A724 returns period identity and station sending hours for the chosen season", async () => {
  const v = await guideVenue();
  const read = await inTx((tx) => readSeasonStaffing(tx, v.cfg, v.seasonId));
  expect(read.guides[`department:${v.departmentId}`]![5]).toEqual([lunchGuide(v)]);
  expect(read.guides[`station:${v.stationId}`]![5]).toEqual([lunchGuide(v, "15:30")]);
  expect(read.guides[`station:${v.passId}`]![5]).toEqual([]);
});

it("A724 returns dated station guides without removing staffing on a closed date", async () => {
  const v = await guideVenue();
  await inTx(async (tx) => {
    await saveSpecialDayStaffing(tx, v.cfg, v.specialDayId, [
      { area: grill(v), dateId: v.aug15, blocks: [block(v.cook)] },
    ]);
    await tx
      .update(specialDayDates)
      .set({ closedAllDay: true })
      .where(eq(specialDayDates.id, v.aug15));
  });
  const read = await inTx((tx) => readSpecialDayStaffing(tx, v.cfg, v.specialDayId));
  expect(read.guides[`department:${v.departmentId}`]![v.aug14]).toEqual([lunchGuide(v)]);
  expect(read.guides[`station:${v.stationId}`]![v.aug14]).toEqual([lunchGuide(v, "15:30")]);
  expect(read.guides[`station:${v.stationId}`]![v.aug15]).toEqual([]);
  expect(
    read.areas
      .find((a) => a.area.kind === "station" && a.area.id === v.stationId)!
      .dates.find((d) => d.dateId === v.aug15)!.blocks,
  ).toEqual([block(v.cook)]);
});

const serviceGuide = (v: { departmentId: string }, periodId: string) => ({
  periodId,
  periodName: "Service",
  periodColour: "grey",
  departmentId: v.departmentId,
  departmentName: "Dining room",
});

it("A724 guides a station by the edited special day, including zone openings", async () => {
  const v = await guideVenue();
  await inTx(async (tx) => {
    const [seasonDay] = await tx
      .insert(zoneDays)
      .values({ zoneId: v.zoneId, seasonId: v.seasonId, weekday: 5 })
      .returning();
    await tx
      .insert(zoneDayRanges)
      .values({ dayId: seasonDay!.id, kind: "closed", startsAt: "12:00:00", endsAt: "15:00:00" });
    const [special] = await tx
      .insert(zoneDays)
      .values({ zoneId: v.zoneId, specialDayDateId: v.aug14 })
      .returning();
    await tx
      .insert(zoneDayRanges)
      .values({ dayId: special!.id, kind: "open", startsAt: "13:00:00", endsAt: "14:00:00" });
    const [other] = await tx
      .insert(specialDays)
      .values({ locationId: v.cfg.locationId, name: "Repeating closure", repeatsYearly: true })
      .returning();
    await tx.insert(specialDayDates).values({
      locationId: v.cfg.locationId,
      specialDayId: other!.id,
      date: "2025-08-14",
      closedAllDay: true,
    });
  });
  const read = await inTx((tx) => readSpecialDayStaffing(tx, v.cfg, v.specialDayId));
  expect(read.guides[`department:${v.departmentId}`]![v.aug14]).toEqual([lunchGuide(v)]);
  expect(read.guides[`station:${v.stationId}`]![v.aug14]).toEqual([
    { ...lunchGuide(v), startsAt: "13:00", endsAt: "14:00" },
    { ...lunchGuide(v), startsAt: "15:00", endsAt: "15:30" },
  ]);
});

it("A724 keeps the sending department identity of every station range", async () => {
  const v = await guideVenue();
  const extra = await inTx(async (tx) => {
    const [department] = await tx
      .insert(departments)
      .values({ locationId: v.cfg.locationId, name: "Takeaway", tradingName: "Takeaway" })
      .returning();
    const [zone] = await tx
      .insert(floorZones)
      .values({ locationId: v.cfg.locationId, name: "Counter" })
      .returning();
    const cfg = { locationId: locationId(v.cfg.locationId) };
    await configureZone(tx, cfg, { zoneId: zone!.id, departmentId: department!.id });
    const [period] = await tx
      .insert(menuPeriods)
      .values({ departmentId: department!.id, menuId: v.menuId, name: "Evening", colour: "green" })
      .returning();
    const [day] = await tx
      .insert(departmentDays)
      .values({ departmentId: department!.id, seasonId: v.seasonId, weekday: 5 })
      .returning();
    await tx.insert(departmentDayRanges).values({
      dayId: day!.id,
      departmentId: department!.id,
      periodId: period!.id,
      startsAt: "13:00:00",
      endsAt: "17:00:00",
    });
    await setRoutingCell(
      tx,
      cfg,
      { row: { kind: "all" }, zoneId: zone!.id },
      { kind: "station", stationId: v.stationId },
    );
    return { periodId: period!.id, departmentId: department!.id };
  });
  const read = await inTx((tx) => readSeasonStaffing(tx, v.cfg, v.seasonId));
  expect(read.guides[`station:${v.stationId}`]![5]).toEqual([
    lunchGuide(v, "15:30"),
    {
      ...extra,
      periodName: "Evening",
      periodColour: "green",
      departmentName: "Takeaway",
      startsAt: "13:00",
      endsAt: "17:00",
    },
  ]);
});

it("A724 returns empty guide maps for a special day with no dates", async () => {
  const v = await venue();
  await inTx((tx) =>
    tx.delete(specialDayDates).where(eq(specialDayDates.specialDayId, v.specialDayId)),
  );
  const read = await inTx((tx) => readSpecialDayStaffing(tx, v.cfg, v.specialDayId));
  expect(Object.values(read.guides)).toEqual([{}, {}, {}]);
  expect(read.areas.every((a) => a.dates.length === 0)).toBe(true);
});

it("A724 adjacent periods with the same colour keep their own names and endpoints", async () => {
  const v = await guideVenue();
  const tea = await inTx(async (tx) => {
    const [period] = await tx
      .insert(menuPeriods)
      .values({ departmentId: v.departmentId, menuId: v.menuId, name: "Tea", colour: "blue" })
      .returning();
    const [day] = await tx
      .select({ id: departmentDays.id })
      .from(departmentDays)
      .where(eq(departmentDays.seasonId, v.seasonId));
    await tx.insert(departmentDayRanges).values({
      dayId: day!.id,
      departmentId: v.departmentId,
      periodId: period!.id,
      startsAt: "16:00:00",
      endsAt: "18:00:00",
    });
    return period!.id;
  });
  const read = await inTx((tx) => readSeasonStaffing(tx, v.cfg, v.seasonId));
  expect(read.guides[`department:${v.departmentId}`]![5]).toEqual([
    lunchGuide(v),
    { ...lunchGuide(v), periodId: tea, periodName: "Tea", startsAt: "16:00", endsAt: "18:00" },
  ]);
  expect(read.guides[`station:${v.stationId}`]![5]).toEqual([
    lunchGuide(v, "15:30"),
    { ...lunchGuide(v), periodId: tea, periodName: "Tea", startsAt: "16:00", endsAt: "18:00" },
  ]);
});

it("A724 a closed own date wins over a repeating open date with sending hours", async () => {
  const v = await guideVenue();
  await inTx(async (tx) => {
    const [day] = await tx
      .insert(departmentDays)
      .values({ departmentId: v.departmentId, seasonId: v.seasonId, weekday: 6 })
      .returning();
    await tx.insert(departmentDayRanges).values({
      dayId: day!.id,
      departmentId: v.departmentId,
      periodId: v.periodId,
      startsAt: "12:00:00",
      endsAt: "16:00:00",
    });
    await tx
      .update(specialDayDates)
      .set({ closedAllDay: true })
      .where(eq(specialDayDates.id, v.aug15));
    const [feria] = await tx
      .insert(specialDays)
      .values({ locationId: v.cfg.locationId, name: "Feria", repeatsYearly: true })
      .returning();
    await tx.insert(specialDayDates).values({
      locationId: v.cfg.locationId,
      specialDayId: feria!.id,
      date: "2025-08-15",
      closedAllDay: false,
    });
  });
  const read = await inTx((tx) => readSpecialDayStaffing(tx, v.cfg, v.specialDayId));
  expect(read.guides[`department:${v.departmentId}`]![v.aug15]).toEqual([]);
  expect(read.guides[`station:${v.stationId}`]![v.aug15]).toEqual([]);
});
