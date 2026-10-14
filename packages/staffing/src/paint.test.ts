import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  kitchenStations,
  locations,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import {
  VENUE_SERVICE_MIGRATIONS,
  departmentDayRanges,
  departmentDays,
  departments,
  seasons,
  specialDayDates,
  specialDays,
} from "@waitron/venue-service";
import { WORKFORCE_MIGRATIONS } from "@waitron/workforce";
import { AppError } from "@waitron/shared";
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
    await save([]);
    const days = await inTx((tx) =>
      tx.select().from(staffingDays).where(eq(staffingDays.departmentId, v.departmentId)),
    );
    expect(days).toEqual([]);
    expect(await inTx((tx) => tx.select().from(staffingBlocks))).not.toContainEqual(
      expect.objectContaining({ staffRoleId: v.cook, headcount: 3 }),
    );
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
    await inTx(async (tx) => {
      for (const [departmentId, weekday, startsAt, endsAt] of [
        [v.departmentId, 3, "19:00:00", "23:30:00"],
        [closed!.id, 3, "10:00:00", "12:00:00"],
      ] as const) {
        const [day] = await tx
          .insert(departmentDays)
          .values({ departmentId, seasonId: v.seasonId, weekday })
          .returning({ id: departmentDays.id });
        await tx
          .insert(departmentDayRanges)
          .values({ dayId: day!.id, departmentId, periodId: null, startsAt, endsAt });
      }
    });
    await switchOff({ kind: "department", id: closed!.id }, false);
    const { guides } = await inTx((tx) => readSeasonStaffing(tx, v.cfg, v.seasonId));
    expect(guides).toEqual({
      [`department:${v.departmentId}`]: {
        ...emptyWeek(),
        3: [{ startsAt: "19:00", endsAt: "23:30" }],
      },
      [`station:${v.passId}`]: emptyWeek(),
      [`station:${v.stationId}`]: emptyWeek(),
    });
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
    expect(await inTx((tx) => readSpecialDayStaffing(tx, v.cfg, v.specialDayId))).toEqual({
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
            { area: dept(v), dateId: other.aug14, blocks: null },
          ]),
        ),
      ),
    ).toEqual({ code: "special_day.not_found", params: { specialDayId: v.specialDayId } });
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
