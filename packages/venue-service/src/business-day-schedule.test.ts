import { readZoneKeepOpenState } from "./operations.js";
import { replaceZoneClosedWeek } from "./zone-closed-times.js";
import { saveSeasonWeeks } from "./season-weeks.js";
import { deletePeriod } from "./period-delete.js";
import { deleteSpecialDay, saveSpecialDay } from "./special-days.js";
import { readSeasons, saveSeasons } from "./seasons.js";
import {
  replaceMenuWeek,
  saveMenuPeriod,
  updateMenuPeriod,
  readOpeningHoursModel,
  resolveDepartmentService,
} from "./menu-timetable.js";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  catalogues,
  floorZones,
  locations,
  locationBusinessDaySettings,
  locationDayCutoverChanges,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { locationId, type BusinessDayClock } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { departments, zoneServicePolicies } from "./schema/service.js";
import { menuPeriods } from "./schema/menus.js";
import {
  departmentDayRanges,
  departmentDays,
  seasons,
  specialDayDates,
  specialDays,
  zoneDayRanges,
  zoneDays,
} from "./schema/seasons.js";
import {
  businessDayClockConflicts,
  assertBusinessDayClockChange,
  assertBusinessDayScheduleWrite,
  keptOpenConflicts,
} from "./business-day-schedule.js";
import { inForceClock, settledClock } from "./service-day-context.js";
import { periodExtensions } from "./schema/period-extensions.js";
import { zoneExtensions } from "./schema/zone-extensions.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
const before: BusinessDayClock = {
  timeZone: "Europe/Madrid",
  dayCutover: "05:00",
  cutoverChanges: [],
};
const E = "2026-11-04";
const candidate = (time: string): BusinessDayClock => ({
  ...before,
  cutoverChanges: [{ effectiveBusinessDay: E, dayCutover: time }],
});
const at = new Date("2026-11-02T12:00:00Z");
/** Saves a new special day on `date` painting the fixture's department (period) or zone (closed). */
const paintDate = (
  v: {
    cfg: { locationId: ReturnType<typeof locationId> };
    departmentId: string;
    periodId: string;
    zoneId?: string;
  },
  target: "menu" | "zone",
  date: string,
  ranges: { startsAt: string; endsAt: string }[],
  when: Date,
  revision: number,
  repeatsYearly = false,
) =>
  withTransaction(suite.db, (tx) =>
    saveSpecialDay(
      tx,
      v.cfg,
      null,
      {
        name: "Special day",
        repeatsYearly,
        dates: [{ date, closedAllDay: false }],
        ...(target === "menu"
          ? {
              paint: [
                {
                  departmentId: v.departmentId,
                  date,
                  ranges: ranges.map((r) => ({ periodId: v.periodId, ...r })),
                },
              ],
            }
          : {
              zonePaint: [
                { zoneId: v.zoneId!, date, ranges: ranges.map((r) => ({ kind: "closed", ...r })) },
              ],
            }),
      },
      when,
      revision,
    ),
  ).then(() => undefined);
async function fixture(
  ranges: { startsAt: string; endsAt: string }[],
  options: {
    offset?: number;
    date?: string;
    annual?: boolean;
    disabled?: boolean;
    closed?: boolean;
    zone?: boolean;
  } = {},
) {
  return withTransaction(suite.db, async (tx) => {
    const loc = locationId(randomUUID());
    await tx.insert(locations).values({
      id: loc,
      name: "Clock venue",
      invoiceLocales: ["en"],
      operationDescription: "Restaurant",
      timeZone: before.timeZone,
      dayCutover: "05:00:00",
    });
    const departmentId = randomUUID();
    await tx.insert(departments).values({
      id: departmentId,
      locationId: loc,
      name: "Service",
      tradingName: "Service",
      active: !options.disabled,
    });
    const menuId = randomUUID();
    await tx.insert(catalogues).values({ id: menuId, name: "Menu" });
    const periodId = randomUUID();
    await tx.insert(menuPeriods).values({
      id: periodId,
      departmentId,
      menuId,
      name: "Service",
      endOffsetMinutes: options.offset ?? 0,
    });
    // One season covers the whole year, so every weekday range is in it.
    const seasonId = randomUUID();
    await tx
      .insert(seasons)
      .values({ id: seasonId, locationId: loc, name: "Winter", startsOn: "12-01" });
    const specialDayId = options.date === undefined ? undefined : randomUUID();
    const specialDayDateId = randomUUID();
    if (specialDayId !== undefined) {
      await tx.insert(specialDays).values({
        id: specialDayId,
        locationId: loc,
        name: "Named day",
        repeatsYearly: options.annual ?? false,
      });
      await tx.insert(specialDayDates).values({
        id: specialDayDateId,
        specialDayId,
        locationId: loc,
        date: options.date!,
        closedAllDay: options.closed ?? false,
      });
    }
    let zoneId: string | undefined;
    if (options.zone) {
      zoneId = randomUUID();
      await tx
        .insert(floorZones)
        .values({ id: zoneId, locationId: loc, name: "Zone", active: !options.disabled });
      await tx.insert(zoneServicePolicies).values({ zoneId, locationId: loc, departmentId });
      if (ranges.length && specialDayId) {
        const dayId = randomUUID();
        await tx.insert(zoneDays).values({ id: dayId, zoneId, specialDayDateId });
        await tx.insert(zoneDayRanges).values(
          ranges.map((r) => ({
            dayId,
            kind: "closed" as const,
            startsAt: `${r.startsAt}:00`,
            endsAt: `${r.endsAt}:00`,
          })),
        );
      } else if (ranges.length) {
        const dayId = randomUUID();
        await tx.insert(zoneDays).values({ id: dayId, zoneId, seasonId, weekday: 3 });
        await tx.insert(zoneDayRanges).values(
          ranges.map((r) => ({
            dayId,
            startsAt: `${r.startsAt}:00`,
            endsAt: `${r.endsAt}:00`,
          })),
        );
      }
    } else if (specialDayId) {
      const dayId = randomUUID();
      await tx.insert(departmentDays).values({ id: dayId, departmentId, specialDayDateId });
      if (ranges.length)
        await tx.insert(departmentDayRanges).values(
          ranges.map((r) => ({
            dayId,
            departmentId,
            periodId,
            startsAt: `${r.startsAt}:00`,
            endsAt: `${r.endsAt}:00`,
          })),
        );
    } else {
      await seasonDay(tx, { departmentId, seasonId, weekday: 3, periodId, ranges });
    }
    return { cfg: { locationId: loc }, departmentId, periodId, seasonId, specialDayId, zoneId };
  });
}
const range = (startsAt: string, endsAt: string) => ({ startsAt, endsAt });
/** Raw rows, bypassing the writers' checks, so a case can hold ranges no writer accepts. */
async function seasonDay(
  tx: Transaction,
  day: {
    departmentId: string;
    seasonId: string;
    weekday: number;
    periodId: string;
    ranges: { startsAt: string; endsAt: string }[];
  },
) {
  const dayId = randomUUID();
  await tx.insert(departmentDays).values({
    id: dayId,
    departmentId: day.departmentId,
    seasonId: day.seasonId,
    weekday: day.weekday,
  });
  if (day.ranges.length)
    await tx.insert(departmentDayRanges).values(
      day.ranges.map((r) => ({
        dayId,
        departmentId: day.departmentId,
        periodId: day.periodId,
        startsAt: `${r.startsAt}:00`,
        endsAt: `${r.endsAt}:00`,
      })),
    );
}
/** Raw special-day rows painting one department, bypassing the special-day writer's checks. */
async function paintedDay(
  tx: Transaction,
  v: { cfg: { locationId: ReturnType<typeof locationId> }; departmentId: string },
  day: {
    name: string;
    date: string;
    repeatsYearly?: boolean;
    closedAllDay?: boolean;
    ranges: { periodId: string | null; startsAt: string; endsAt: string }[];
  },
) {
  const specialDayId = randomUUID(),
    dateId = randomUUID(),
    dayId = randomUUID();
  await tx.insert(specialDays).values({
    id: specialDayId,
    locationId: v.cfg.locationId,
    name: day.name,
    repeatsYearly: day.repeatsYearly ?? false,
  });
  await tx.insert(specialDayDates).values({
    id: dateId,
    specialDayId,
    locationId: v.cfg.locationId,
    date: day.date,
    closedAllDay: day.closedAllDay ?? false,
  });
  await tx
    .insert(departmentDays)
    .values({ id: dayId, departmentId: v.departmentId, specialDayDateId: dateId });
  if (day.ranges.length > 0)
    await tx.insert(departmentDayRanges).values(
      day.ranges.map((r) => ({
        dayId,
        departmentId: v.departmentId,
        periodId: r.periodId,
        startsAt: `${r.startsAt}:00`,
        endsAt: `${r.endsAt}:00`,
      })),
    );
  return specialDayId;
}
/** The fixture's venue with its hours written through the public week writers on one weekday,
 *  for the cases that read the sale path. */
async function writtenFixture(
  ranges: { startsAt: string; endsAt: string }[],
  options: Parameters<typeof fixture>[1] & { weekday: number; dayCutover?: string },
) {
  const v = await fixture([], options);
  await withTransaction(suite.db, async (tx) => {
    if (options.dayCutover !== undefined)
      await tx
        .update(locations)
        .set({ dayCutover: `${options.dayCutover}:00` })
        .where(eq(locations.id, v.cfg.locationId));
    const on = <T>(entries: T[]) =>
      Array.from({ length: 7 }, (_, weekday) => (weekday === options.weekday ? entries : []));
    if (options.zone)
      await replaceZoneClosedWeek(
        tx,
        v.cfg,
        v.zoneId!,
        on(ranges).map((entries, weekday) => ({ weekday, ranges: entries })),
        0,
        at,
      );
    else
      await replaceMenuWeek(
        tx,
        v.cfg,
        v.departmentId,
        on(ranges.map((r) => ({ periodId: v.periodId, ...r }))).map((slots, weekday) => ({
          weekday,
          slots,
        })),
        at,
        0,
      );
  });
  return v;
}
const check = (v: Awaited<ReturnType<typeof fixture>>, time: string) =>
  withTransaction(suite.db, (tx) =>
    assertBusinessDayClockChange(tx, v.cfg, before, candidate(time), E),
  );

describe("business-day schedule compatibility", () => {
  it.each(["03:00", "07:00"])("refuses an equal-endpoint all-day range under %s", async (time) => {
    const v = await fixture([range("05:00", "05:00")]);
    await expect(check(v, time)).rejects.toMatchObject({
      code: "venue.business_day_hours_conflict",
      params: {
        conflictCount: 1,
        conflicts: [
          {
            departmentId: v.departmentId,
            periodId: v.periodId,
            weekday: 3,
            rangeIndex: 0,
            reason: "all_day",
          },
        ],
      },
    });
  });
  it("refuses a range whose endpoint changes calendar-day ownership", async () => {
    const v = await fixture([range("22:00", "04:30")]);
    await expect(check(v, "03:00")).rejects.toMatchObject({
      code: "venue.business_day_hours_conflict",
      params: { conflictCount: 1 },
    });
    await expect(check(v, "07:00")).resolves.toBeUndefined();
  });
  it.each(["03:00", "07:00"])("keeps an ordinary daytime range under %s", async (time) => {
    await expect(check(await fixture([range("09:00", "17:00")]), time)).resolves.toBeUndefined();
  });
  it("checks a sending cutoff in the changed strip and a zero-offset endpoint", async () => {
    const grace = await fixture([range("22:00", "04:30")], { offset: 60 });
    await expect(check(grace, "07:00")).rejects.toMatchObject({
      code: "venue.business_day_hours_conflict",
      params: { conflicts: [{ reason: "transition_strip" }] },
    });
    const zero = await fixture([range("06:00", "09:00")]);
    await expect(check(zero, "07:00")).rejects.toMatchObject({
      code: "venue.business_day_hours_conflict",
    });
  });
  it.each([
    { disabled: true },
    { annual: true, date: "2025-12-25" },
    { closed: true, date: "2026-12-25" },
    { zone: true, disabled: true },
  ])("reads dormant raw ranges %j", async (options) => {
    const v = await fixture([range("05:00", "05:00")], options);
    await expect(check(v, "07:00")).rejects.toMatchObject({
      code: "venue.business_day_hours_conflict",
      params: {
        conflicts: [
          expect.objectContaining({
            departmentId: v.departmentId,
            ...(v.zoneId === undefined ? {} : { zoneId: v.zoneId }),
          }),
        ],
      },
    });
  });
  it("ignores past one-off ranges but validates future dates", async () => {
    await expect(
      check(await fixture([range("05:00", "05:00")], { date: "2026-10-10" }), "07:00"),
    ).resolves.toBeUndefined();
    await expect(
      check(await fixture([range("05:00", "05:00")], { date: E }), "07:00"),
    ).rejects.toMatchObject({ code: "venue.business_day_hours_conflict" });
  });
  it("rejects overlapping raw ranges rather than relying on prior authoring", async () => {
    await expect(
      check(await fixture([range("09:00", "17:00"), range("16:00", "18:00")]), "07:00"),
    ).rejects.toMatchObject({
      code: "venue.business_day_hours_conflict",
      params: {
        conflictCount: 2,
        conflicts: [
          expect.objectContaining({ reason: "overlap" }),
          expect.objectContaining({ reason: "overlap" }),
        ],
      },
    });
  });
  it("names only the range that crosses the new start, leaving its day's other range clear", async () => {
    const v = await fixture([range("13:00", "16:00"), range("22:00", "04:30")]);
    await expect(check(v, "03:00")).rejects.toMatchObject({
      code: "venue.business_day_hours_conflict",
      params: {
        conflictCount: 1,
        conflicts: [
          { startsAt: "22:00", endsAt: "04:30", weekday: 3, rangeIndex: 1, reason: "range" },
        ],
      },
    });
  });
  it("marks a stored range already invalid under the old start as overlap, not as crossing the new one", async () => {
    const v = await fixture([range("13:00", "16:00"), range("04:00", "06:00")]);
    await expect(check(v, "03:00")).rejects.toMatchObject({
      code: "venue.business_day_hours_conflict",
      params: {
        conflictCount: 1,
        conflicts: [{ startsAt: "04:00", endsAt: "06:00", reason: "overlap" }],
      },
    });
  });
  it("checks the other ranges of a day with a crossing range for their own clashes", async () => {
    const v = await fixture([range("13:00", "16:00"), range("20:00", "23:30")]);
    await expect(check(v, "21:00")).rejects.toMatchObject({
      code: "venue.business_day_hours_conflict",
      params: {
        conflictCount: 2,
        conflicts: [
          { startsAt: "13:00", endsAt: "16:00", rangeIndex: 0, reason: "endpoint_day" },
          { startsAt: "20:00", endsAt: "23:30", rangeIndex: 1, reason: "range" },
        ],
      },
    });
  });
  it("leaves a crossing range out of a sending cutoff's later ranges", async () => {
    const v = await fixture([range("09:00", "17:00"), range("17:30", "04:30")], { offset: 60 });
    await expect(check(v, "03:00")).rejects.toMatchObject({
      code: "venue.business_day_hours_conflict",
      params: {
        conflictCount: 1,
        conflicts: [{ startsAt: "17:30", endsAt: "04:30", reason: "range" }],
      },
    });
  });
  it("marks each one-range night that crosses the new start (mockup 04)", async () => {
    const v = await fixture([]);
    await withTransaction(suite.db, async (tx) => {
      for (const [weekday, endsAt] of [
        [5, "04:00"],
        [6, "04:30"],
      ] as const)
        await seasonDay(tx, { ...v, weekday, ranges: [range("21:00", endsAt)] });
    });
    await expect(check(v, "03:00")).rejects.toMatchObject({
      code: "venue.business_day_hours_conflict",
      params: {
        conflictCount: 2,
        conflicts: [
          { startsAt: "21:00", endsAt: "04:00", weekday: 5, reason: "range" },
          { startsAt: "21:00", endsAt: "04:30", weekday: 6, reason: "range" },
        ],
      },
    });
  });
  it("checks grace against the next placement", async () => {
    const v = await fixture([range("09:00", "17:00"), range("18:00", "20:00")], { offset: 60 });
    await expect(check(v, "07:00")).rejects.toMatchObject({
      code: "venue.business_day_hours_conflict",
      params: { conflicts: [expect.objectContaining({ reason: "sending_cutoff" })] },
    });
  });
  it("bounds conflict references without losing the total", async () => {
    const v = await fixture(Array.from({ length: 24 }, () => range("05:00", "05:00")));
    await expect(check(v, "07:00")).rejects.toMatchObject({
      code: "venue.business_day_hours_conflict",
      params: { conflictCount: 24, conflicts: expect.any(Array) },
    });
    try {
      await check(v, "07:00");
    } catch (error) {
      expect((error as { params: { conflicts: unknown[] } }).params.conflicts).toHaveLength(20);
    }
  });
});
describe("schedule clock guard", () => {
  it("allows time writes while a change waits, allows metadata, and retains revision after cancellation", async () => {
    const v = await fixture([]);
    await withTransaction(suite.db, async (tx) => {
      await tx
        .insert(locationBusinessDaySettings)
        .values({ locationId: v.cfg.locationId, revision: 1 });
      await tx
        .insert(locationDayCutoverChanges)
        .values({ locationId: v.cfg.locationId, effectiveBusinessDay: E, dayCutover: "07:00:00" });
    });
    const guard = (kind: "time" | "metadata", revision: number) =>
      withTransaction(suite.db, (tx) => assertBusinessDayScheduleWrite(tx, v.cfg, kind, revision));
    await expect(guard("time", 1)).resolves.toBeUndefined();
    await expect(guard("metadata", 0)).resolves.toBeUndefined();
    await expect(guard("time", 0)).rejects.toMatchObject({
      code: "hours.clock_changed",
      params: {},
    });
    await withTransaction(suite.db, (tx) =>
      tx
        .delete(locationDayCutoverChanges)
        .where(eq(locationDayCutoverChanges.locationId, v.cfg.locationId)),
    );
    await expect(guard("time", 0)).rejects.toMatchObject({ code: "hours.clock_changed" });
    await expect(guard("time", 1)).resolves.toBeUndefined();
    for (const revision of [-1, NaN, 0.5, undefined])
      await expect(guard("time", revision as number)).rejects.toMatchObject({
        code: "hours.clock_changed",
      });
  });
});

describe("service boundaries remain chronological", () => {
  it.each([
    ["2026-10-25T00:45:00Z", "2026-10-25T01:30:00Z"],
    ["2026-03-29T01:10:00Z", "2026-03-29T01:30:00Z"],
  ])("keeps an initial 02:30 all-day period running at %s", async (instant, end) => {
    const v = await writtenFixture([range("02:30", "02:30")], { weekday: 6, dayCutover: "02:30" });
    const read = (time: string) =>
      withTransaction(suite.db, (tx) =>
        resolveDepartmentService(tx, v.cfg, v.departmentId, new Date(time)),
      );
    const running = await read(instant);
    expect(running.open).toBe(true);
    expect(running.orderableMenuIds).toHaveLength(1);
    expect(running.endedMenuIds).toEqual([]);
    expect(running.keepOpen).toMatchObject({ periodId: v.periodId, running: true });
    expect((await read(end)).open).toBe(false);
  });
});

describe("every time writer stays open while a change waits", () => {
  async function pending(v: Awaited<ReturnType<typeof fixture>>) {
    await withTransaction(suite.db, async (tx) => {
      await tx
        .insert(locationBusinessDaySettings)
        .values({ locationId: v.cfg.locationId, revision: 1 });
      await tx
        .insert(locationDayCutoverChanges)
        .values({ locationId: v.cfg.locationId, effectiveBusinessDay: E, dayCutover: "07:00:00" });
    });
  }
  it("accepts normal and special-day menu ranges and an equivalent week", async () => {
    const v = await fixture([range("09:00", "17:00")], { date: "2026-12-25" });
    await pending(v);
    await expect(
      paintDate(v, "menu", "2026-12-26", [range("09:00", "18:00")], at, 1),
    ).resolves.toBeUndefined();
    const week = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      slots: weekday === 3 ? [{ periodId: v.periodId, ...range("09:00", "17:00") }] : [],
    }));
    const empty = week.map((day) => ({ ...day, slots: [] }));
    await expect(
      withTransaction(suite.db, (tx) => replaceMenuWeek(tx, v.cfg, v.departmentId, empty, at, 0)),
    ).resolves.toBeUndefined();
    await expect(
      withTransaction(suite.db, (tx) => replaceMenuWeek(tx, v.cfg, v.departmentId, week, at, 1)),
    ).resolves.toBeUndefined();
  });
  it("accepts offsets, names, colours and equivalent offsets", async () => {
    const v = await fixture([range("09:00", "17:00")]);
    await pending(v);
    await expect(
      withTransaction(suite.db, (tx) =>
        updateMenuPeriod(
          tx,
          v.cfg,
          v.periodId,
          { name: "Lunch", colour: "blue", endOffsetMinutes: 0 },
          0,
          at,
        ),
      ),
    ).resolves.toBeUndefined();
    await expect(
      withTransaction(suite.db, (tx) =>
        updateMenuPeriod(tx, v.cfg, v.periodId, { endOffsetMinutes: 1 }, 1, at),
      ),
    ).resolves.toBeUndefined();
  });
  it("accepts zone closed weeks and dates", async () => {
    const v = await fixture([range("09:00", "10:00")], { zone: true, date: "2026-12-25" });
    await pending(v);
    await expect(
      withTransaction(suite.db, (tx) =>
        replaceZoneClosedWeek(
          tx,
          v.cfg,
          v.zoneId!,
          Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            ranges: weekday === 3 ? [range("12:00", "13:00")] : [],
          })),
          1,
          at,
        ),
      ),
    ).resolves.toBeUndefined();
    await expect(
      paintDate(v, "zone", "2026-12-26", [range("12:00", "13:00")], at, 1),
    ).resolves.toBeUndefined();
  });
});

describe("a waiting change checks the hours written while it waits", () => {
  async function waiting(v: Awaited<ReturnType<typeof fixture>>, dayCutover = "03:00") {
    await withTransaction(suite.db, async (tx) => {
      await tx
        .insert(locationBusinessDaySettings)
        .values({ locationId: v.cfg.locationId, revision: 1 });
      await tx.insert(locationDayCutoverChanges).values({
        locationId: v.cfg.locationId,
        effectiveBusinessDay: E,
        dayCutover: `${dayCutover}:00`,
      });
    });
  }
  const weekOf = (
    periodId: string,
    weekday: number,
    ranges: { startsAt: string; endsAt: string }[],
  ) =>
    Array.from({ length: 7 }, (_, day) => ({
      weekday: day,
      slots: day === weekday ? ranges.map((r) => ({ periodId, ...r })) : [],
    }));
  const stored = (v: Awaited<ReturnType<typeof fixture>>) =>
    withTransaction(suite.db, async (tx) =>
      (
        await tx
          .select({
            weekday: departmentDays.weekday,
            startsAt: departmentDayRanges.startsAt,
            endsAt: departmentDayRanges.endsAt,
          })
          .from(departmentDayRanges)
          .innerJoin(departmentDays, eq(departmentDays.id, departmentDayRanges.dayId))
          .where(eq(departmentDays.departmentId, v.departmentId))
      )
        .map((row) => `${row.weekday} ${row.startsAt}-${row.endsAt}`)
        .sort(),
    );
  const offsetOf = (v: Awaited<ReturnType<typeof fixture>>) =>
    withTransaction(suite.db, async (tx) => {
      const [row] = await tx
        .select({ offset: menuPeriods.endOffsetMinutes })
        .from(menuPeriods)
        .where(eq(menuPeriods.id, v.periodId));
      return row!.offset;
    });
  const writeWeek = (
    v: Awaited<ReturnType<typeof fixture>>,
    weekday: number,
    ranges: { startsAt: string; endsAt: string }[],
  ) =>
    withTransaction(suite.db, (tx) =>
      replaceMenuWeek(tx, v.cfg, v.departmentId, weekOf(v.periodId, weekday, ranges), at, 1),
    );

  it("stores a week that fits the waiting start", async () => {
    const v = await fixture([]);
    await waiting(v);
    await expect(writeWeek(v, 3, [range("09:00", "17:00")])).resolves.toBeUndefined();
    expect(await stored(v)).toEqual(["3 09:00:00-17:00:00"]);
  });
  it("refuses a week crossing the waiting start, naming the range, and writes nothing", async () => {
    const v = await fixture([range("12:00", "15:00")]);
    await waiting(v);
    const before = await stored(v);
    await expect(writeWeek(v, 6, [range("21:00", "04:30")])).rejects.toMatchObject({
      code: "hours.clock_change_conflict",
      params: {
        dayCutover: "03:00",
        timeZone: "Europe/Madrid",
        startsAt: "2026-11-04T02:00:00.000Z",
        conflictCount: 1,
        conflicts: [
          expect.objectContaining({
            weekday: 6,
            startsAt: "21:00",
            endsAt: "04:30",
            reason: "range",
          }),
        ],
      },
    });
    expect(await stored(v)).toEqual(before);
  });
  it("refuses last orders running into the waiting start (mockup 06), writing nothing", async () => {
    const v = await fixture([], { offset: 30 });
    await waiting(v);
    await expect(writeWeek(v, 6, [range("21:00", "02:45")])).rejects.toMatchObject({
      code: "hours.clock_change_conflict",
      params: {
        dayCutover: "03:00",
        timeZone: "Europe/Madrid",
        conflicts: [expect.objectContaining({ reason: "transition_strip" })],
      },
    });
    expect(await stored(v)).toEqual([]);
  });
  it("refuses an offset that runs a stored range into the waiting start, keeping the old offset", async () => {
    const v = await fixture([]);
    await withTransaction(suite.db, (tx) =>
      seasonDay(tx, { ...v, weekday: 6, ranges: [range("21:00", "02:45")] }),
    );
    await waiting(v);
    await expect(
      withTransaction(suite.db, (tx) =>
        updateMenuPeriod(tx, v.cfg, v.periodId, { endOffsetMinutes: 30 }, 1, at),
      ),
    ).rejects.toMatchObject({
      code: "hours.clock_change_conflict",
      params: { conflicts: [expect.objectContaining({ reason: "transition_strip" })] },
    });
    expect(await offsetOf(v)).toBe(0);
  });
  it("checks a changed offset's last orders under the starts in force, leaving the waiting one to the after-write check", async () => {
    const v = await fixture([]);
    await withTransaction(suite.db, async (tx) => {
      await seasonDay(tx, { ...v, weekday: 5, ranges: [range("01:00", "03:00")] });
      await seasonDay(tx, { ...v, weekday: 6, ranges: [range("03:00", "04:00")] });
    });
    await waiting(v);
    await expect(
      withTransaction(suite.db, (tx) =>
        updateMenuPeriod(tx, v.cfg, v.periodId, { endOffsetMinutes: 30 }, 1, at),
      ),
    ).rejects.toMatchObject({
      code: "hours.clock_change_conflict",
      params: {
        dayCutover: "03:00",
        timeZone: "Europe/Madrid",
        startsAt: "2026-11-04T02:00:00.000Z",
        conflictCount: 2,
        conflicts: [
          expect.objectContaining({
            weekday: 5,
            startsAt: "01:00",
            endsAt: "03:00",
            reason: "sending_cutoff",
          }),
          expect.objectContaining({
            weekday: 6,
            startsAt: "03:00",
            endsAt: "04:00",
            reason: "endpoint_day",
          }),
        ],
      },
    });
    expect(await offsetOf(v)).toBe(0);
  });
  it("accepts a period rename beside a stored range that clashes with the waiting start", async () => {
    const v = await fixture([]);
    await withTransaction(suite.db, (tx) =>
      seasonDay(tx, { ...v, weekday: 6, ranges: [range("21:00", "04:30")] }),
    );
    await waiting(v);
    await expect(
      withTransaction(suite.db, (tx) =>
        updateMenuPeriod(tx, v.cfg, v.periodId, { name: "Late" }, 0, at),
      ),
    ).resolves.toBeUndefined();
  });
  it("creates a period with an offset and no ranges while a change waits", async () => {
    const v = await fixture([]);
    await waiting(v);
    const menuId = randomUUID();
    await withTransaction(suite.db, (tx) =>
      tx.insert(catalogues).values({ id: menuId, name: "Late" }),
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        saveMenuPeriod(
          tx,
          v.cfg,
          v.departmentId,
          { name: "Late", menuId, staffMenuIds: [], endOffsetMinutes: 15 },
          1,
          at,
        ),
      ),
    ).resolves.toMatchObject({ id: expect.any(String) });
  });
  it("answers last orders clashing only under the waiting start as a waiting-change conflict", async () => {
    const v = await fixture([], { offset: 30 });
    await waiting(v);
    const week = weekOf(v.periodId, 5, [range("01:00", "03:00")]);
    week[6]!.slots = [{ periodId: v.periodId, ...range("03:00", "04:00") }];
    await expect(
      withTransaction(suite.db, (tx) => replaceMenuWeek(tx, v.cfg, v.departmentId, week, at, 1)),
    ).rejects.toMatchObject({
      code: "hours.clock_change_conflict",
      params: {
        dayCutover: "03:00",
        timeZone: "Europe/Madrid",
        startsAt: "2026-11-04T02:00:00.000Z",
        conflictCount: 2,
        conflicts: [
          expect.objectContaining({
            weekday: 5,
            startsAt: "01:00",
            endsAt: "03:00",
            reason: "sending_cutoff",
          }),
          expect.objectContaining({
            weekday: 6,
            startsAt: "03:00",
            endsAt: "04:00",
            reason: "endpoint_day",
          }),
        ],
      },
    });
    expect(await stored(v)).toEqual([]);
  });
  const storedZone = (v: Awaited<ReturnType<typeof fixture>>) =>
    withTransaction(suite.db, async (tx) =>
      (
        await tx
          .select({
            weekday: zoneDays.weekday,
            startsAt: zoneDayRanges.startsAt,
            endsAt: zoneDayRanges.endsAt,
          })
          .from(zoneDayRanges)
          .innerJoin(zoneDays, eq(zoneDays.id, zoneDayRanges.dayId))
          .where(eq(zoneDays.zoneId, v.zoneId!))
      )
        .map((row) => `${row.weekday} ${row.startsAt}-${row.endsAt}`)
        .sort(),
    );
  const writeZoneWeek = (
    v: Awaited<ReturnType<typeof fixture>>,
    ranges: { startsAt: string; endsAt: string }[],
  ) =>
    withTransaction(suite.db, (tx) =>
      replaceZoneClosedWeek(
        tx,
        v.cfg,
        v.zoneId!,
        Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          ranges: weekday === 6 ? ranges : [],
        })),
        1,
        at,
      ),
    );
  const writeSeasonWeek = (
    v: Awaited<ReturnType<typeof fixture>>,
    weekday: number,
    ranges: { startsAt: string; endsAt: string }[],
  ) =>
    withTransaction(suite.db, (tx) =>
      saveSeasonWeeks(
        tx,
        v.cfg,
        v.seasonId,
        {
          departments: [
            { departmentId: v.departmentId, days: weekOf(v.periodId, weekday, ranges) },
          ],
        },
        at,
        1,
      ),
    );
  /** A second period, "Brunch", in the fixture's department, holding no ranges. */
  const secondPeriod = (v: Awaited<ReturnType<typeof fixture>>) =>
    withTransaction(suite.db, async (tx) => {
      const [period] = await tx
        .select({ menuId: menuPeriods.menuId })
        .from(menuPeriods)
        .where(eq(menuPeriods.id, v.periodId));
      const id = randomUUID();
      await tx
        .insert(menuPeriods)
        .values({ id, departmentId: v.departmentId, menuId: period!.menuId, name: "Brunch" });
      return id;
    });
  const periodsLeft = (v: Awaited<ReturnType<typeof fixture>>) =>
    withTransaction(suite.db, async (tx) =>
      (
        await tx
          .select({ id: menuPeriods.id })
          .from(menuPeriods)
          .where(eq(menuPeriods.departmentId, v.departmentId))
      )
        .map((row) => row.id)
        .sort(),
    );
  const removePeriod = (v: Awaited<ReturnType<typeof fixture>>, periodId: string) =>
    withTransaction(suite.db, (tx) => deletePeriod(tx, v.cfg, periodId, null, at, 1));
  /** Last orders 30 minutes after Fri 01:00–03:00 and Sat 03:00–04:00: each fits 05:00, and under
   *  the waiting 03:00 Friday's runs into the new start and Saturday's opens on the day before. */
  const offsetClash = {
    dayCutover: "03:00",
    timeZone: "Europe/Madrid",
    startsAt: "2026-11-04T02:00:00.000Z",
    conflictCount: 2,
    conflicts: [
      expect.objectContaining({
        weekday: 5,
        startsAt: "01:00",
        endsAt: "03:00",
        reason: "sending_cutoff",
      }),
      expect.objectContaining({
        weekday: 6,
        startsAt: "03:00",
        endsAt: "04:00",
        reason: "endpoint_day",
      }),
    ],
  };
  /** A second department, "Bar", with one period holding raw ranges on `weekday`. */
  const otherDepartment = (
    v: Awaited<ReturnType<typeof fixture>>,
    weekday: number,
    ranges: { startsAt: string; endsAt: string }[],
  ) =>
    withTransaction(suite.db, async (tx) => {
      const departmentId = randomUUID();
      await tx.insert(departments).values({
        id: departmentId,
        locationId: v.cfg.locationId,
        name: "Bar",
        tradingName: "Bar",
      });
      const menuId = randomUUID();
      await tx.insert(catalogues).values({ id: menuId, name: "Bar menu" });
      const periodId = randomUUID();
      await tx.insert(menuPeriods).values({ id: periodId, departmentId, menuId, name: "Bar" });
      await seasonDay(tx, { departmentId, seasonId: v.seasonId, weekday, periodId, ranges });
      return { departmentId, periodId };
    });

  it("refuses a zone closed week crossing the waiting start, naming the zone, and writes nothing", async () => {
    const v = await fixture([], { zone: true });
    await waiting(v);
    await expect(writeZoneWeek(v, [range("22:00", "04:30")])).rejects.toMatchObject({
      code: "hours.clock_change_conflict",
      params: {
        dayCutover: "03:00",
        timeZone: "Europe/Madrid",
        startsAt: "2026-11-04T02:00:00.000Z",
        conflictCount: 1,
        conflicts: [
          expect.objectContaining({
            zoneId: v.zoneId,
            zoneName: "Zone",
            weekday: 6,
            startsAt: "22:00",
            endsAt: "04:30",
            reason: "range",
          }),
        ],
      },
    });
    expect(await storedZone(v)).toEqual([]);
    await expect(writeZoneWeek(v, [range("12:00", "13:00")])).resolves.toBeUndefined();
    expect(await storedZone(v)).toEqual(["6 12:00:00-13:00:00"]);
  });
  it("refuses a season week crossing the waiting start, writing nothing, and stores one that fits", async () => {
    const v = await fixture([]);
    await waiting(v);
    await expect(writeSeasonWeek(v, 6, [range("21:00", "04:30")])).rejects.toMatchObject({
      code: "hours.clock_change_conflict",
      params: {
        dayCutover: "03:00",
        timeZone: "Europe/Madrid",
        startsAt: "2026-11-04T02:00:00.000Z",
        conflictCount: 1,
        conflicts: [
          expect.objectContaining({
            departmentId: v.departmentId,
            weekday: 6,
            startsAt: "21:00",
            endsAt: "04:30",
            reason: "range",
          }),
        ],
      },
    });
    expect(await stored(v)).toEqual([]);
    await expect(writeSeasonWeek(v, 3, [range("09:00", "17:00")])).resolves.toBeUndefined();
    expect(await stored(v)).toEqual(["3 09:00:00-17:00:00"]);
  });
  it("refuses a clean season week while another department holds a clash, naming that department", async () => {
    const v = await fixture([]);
    const bar = await otherDepartment(v, 6, [range("21:00", "04:30")]);
    await waiting(v);
    await expect(writeSeasonWeek(v, 3, [range("09:00", "17:00")])).rejects.toMatchObject({
      code: "hours.clock_change_conflict",
      params: {
        dayCutover: "03:00",
        timeZone: "Europe/Madrid",
        conflictCount: 1,
        conflicts: [
          expect.objectContaining({
            departmentId: bar.departmentId,
            departmentName: "Bar",
            periodId: bar.periodId,
            weekday: 6,
            startsAt: "21:00",
            endsAt: "04:30",
            reason: "range",
          }),
        ],
      },
    });
    expect(await stored(v)).toEqual([]);
  });
  it("refuses deleting a period while another of its department's periods clashes, and deletes the clashing one", async () => {
    const v = await fixture([]);
    await withTransaction(suite.db, (tx) =>
      seasonDay(tx, { ...v, weekday: 6, ranges: [range("21:00", "04:30")] }),
    );
    const otherPeriod = await secondPeriod(v);
    await waiting(v);
    const kept = await stored(v);
    await expect(removePeriod(v, otherPeriod)).rejects.toMatchObject({
      code: "hours.clock_change_conflict",
      params: {
        dayCutover: "03:00",
        timeZone: "Europe/Madrid",
        conflictCount: 1,
        conflicts: [
          expect.objectContaining({
            periodId: v.periodId,
            weekday: 6,
            startsAt: "21:00",
            endsAt: "04:30",
            reason: "range",
          }),
        ],
      },
    });
    expect(await periodsLeft(v)).toEqual([v.periodId, otherPeriod].sort());
    expect(await stored(v)).toEqual(kept);
    expect(kept).toEqual(["6 21:00:00-04:30:00"]);
    await expect(removePeriod(v, v.periodId)).resolves.toBeUndefined();
    expect(await periodsLeft(v)).toEqual([otherPeriod]);
    expect(await stored(v)).toEqual([]);
  });
  it("answers a period delete whose last orders clash only under the waiting start as a waiting-change conflict", async () => {
    const v = await fixture([], { offset: 30 });
    await withTransaction(suite.db, async (tx) => {
      await seasonDay(tx, { ...v, weekday: 5, ranges: [range("01:00", "03:00")] });
      await seasonDay(tx, { ...v, weekday: 6, ranges: [range("03:00", "04:00")] });
    });
    const otherPeriod = await secondPeriod(v);
    await waiting(v);
    const kept = await stored(v);
    await expect(removePeriod(v, otherPeriod)).rejects.toMatchObject({
      code: "hours.clock_change_conflict",
      params: offsetClash,
    });
    expect(await periodsLeft(v)).toEqual([v.periodId, otherPeriod].sort());
    expect(await stored(v)).toEqual(kept);
  });
  it("answers a season week whose last orders clash only under the waiting start as a waiting-change conflict", async () => {
    const v = await fixture([], { offset: 30 });
    await waiting(v);
    const week = weekOf(v.periodId, 5, [range("01:00", "03:00")]);
    week[6]!.slots = [{ periodId: v.periodId, ...range("03:00", "04:00") }];
    await expect(
      withTransaction(suite.db, (tx) =>
        saveSeasonWeeks(
          tx,
          v.cfg,
          v.seasonId,
          { departments: [{ departmentId: v.departmentId, days: week }] },
          at,
          1,
        ),
      ),
    ).rejects.toMatchObject({ code: "hours.clock_change_conflict", params: offsetClash });
    expect(await stored(v)).toEqual([]);
  });
  it("answers a season save's zone week crossing the waiting start as a waiting-change conflict", async () => {
    const v = await fixture([], { zone: true });
    await waiting(v);
    await expect(
      withTransaction(suite.db, (tx) =>
        saveSeasonWeeks(
          tx,
          v.cfg,
          v.seasonId,
          {
            zones: [
              {
                zoneId: v.zoneId!,
                days: Array.from({ length: 7 }, (_, weekday) => ({
                  weekday,
                  ranges: weekday === 6 ? [range("22:00", "04:30")] : [],
                })),
              },
            ],
          },
          at,
          1,
        ),
      ),
    ).rejects.toMatchObject({
      code: "hours.clock_change_conflict",
      params: {
        dayCutover: "03:00",
        timeZone: "Europe/Madrid",
        startsAt: "2026-11-04T02:00:00.000Z",
        conflictCount: 1,
        conflicts: [
          expect.objectContaining({
            zoneId: v.zoneId,
            weekday: 6,
            startsAt: "22:00",
            endsAt: "04:30",
            reason: "range",
          }),
        ],
      },
    });
    expect(await storedZone(v)).toEqual([]);
  });
  const specialDayNames = (v: Awaited<ReturnType<typeof fixture>>) =>
    withTransaction(suite.db, async (tx) =>
      (
        await tx
          .select({ name: specialDays.name })
          .from(specialDays)
          .where(eq(specialDays.locationId, v.cfg.locationId))
      )
        .map((row) => row.name)
        .sort(),
    );
  const seasonNames = (v: Awaited<ReturnType<typeof fixture>>) =>
    withTransaction(suite.db, async (tx) => (await readSeasons(tx, v.cfg)).map((s) => s.name));
  const addSeason = (v: Awaited<ReturnType<typeof fixture>>) =>
    withTransaction(suite.db, (tx) =>
      saveSeasons(
        tx,
        v.cfg,
        { save: [{ name: "Summer", startsOn: "06-01", colour: "blue" }], delete: [] },
        at,
        1,
      ),
    );
  const removeSpecialDay = (v: Awaited<ReturnType<typeof fixture>>, id: string) =>
    withTransaction(suite.db, (tx) => deleteSpecialDay(tx, v.cfg, id, at, 1));

  it("refuses a one-off special day crossing the waiting start on its date, naming it, and stores one that fits", async () => {
    const v = await fixture([]);
    await waiting(v);
    await expect(
      paintDate(v, "menu", "2026-11-04", [range("22:00", "04:30")], at, 1),
    ).rejects.toMatchObject({
      code: "hours.clock_change_conflict",
      params: {
        dayCutover: "03:00",
        timeZone: "Europe/Madrid",
        startsAt: "2026-11-04T02:00:00.000Z",
        conflictCount: 1,
        conflicts: [
          expect.objectContaining({
            departmentId: v.departmentId,
            specialDayName: "Special day",
            date: "2026-11-04",
            startsAt: "22:00",
            endsAt: "04:30",
            reason: "range",
          }),
        ],
      },
    });
    expect(await specialDayNames(v)).toEqual([]);
    await expect(
      paintDate(v, "menu", "2026-11-04", [range("09:00", "17:00")], at, 1),
    ).resolves.toBeUndefined();
    expect(await specialDayNames(v)).toEqual(["Special day"]);
  });
  it("refuses a repeating special day crossing the waiting start, parsing it under the start in force", async () => {
    const v = await fixture([]);
    await waiting(v);
    await expect(
      paintDate(v, "menu", "2026-12-25", [range("22:00", "04:30")], at, 1, true),
    ).rejects.toMatchObject({
      code: "hours.clock_change_conflict",
      params: {
        dayCutover: "03:00",
        timeZone: "Europe/Madrid",
        conflicts: [
          expect.objectContaining({
            specialDayName: "Special day",
            startsAt: "22:00",
            endsAt: "04:30",
            reason: "range",
          }),
        ],
      },
    });
    expect(await specialDayNames(v)).toEqual([]);
  });
  it("refuses a special day's zone paint crossing the waiting start, and stores one that fits", async () => {
    const v = await fixture([], { zone: true });
    await waiting(v);
    await expect(
      paintDate(v, "zone", "2026-11-04", [range("22:00", "04:30")], at, 1),
    ).rejects.toMatchObject({
      code: "hours.clock_change_conflict",
      params: {
        dayCutover: "03:00",
        timeZone: "Europe/Madrid",
        startsAt: "2026-11-04T02:00:00.000Z",
        conflictCount: 1,
        conflicts: [
          expect.objectContaining({
            zoneId: v.zoneId,
            specialDayName: "Special day",
            date: "2026-11-04",
            startsAt: "22:00",
            endsAt: "04:30",
            reason: "range",
          }),
        ],
      },
    });
    expect(await specialDayNames(v)).toEqual([]);
    await expect(
      paintDate(v, "zone", "2026-11-04", [range("09:00", "17:00")], at, 1),
    ).resolves.toBeUndefined();
    expect(await specialDayNames(v)).toEqual(["Special day"]);
  });
  // The two dates' conflicts came back in either order across repeat runs.
  it("answers a special day whose last orders clash only under the waiting start as a waiting-change conflict", async () => {
    const v = await fixture([], { offset: 30 });
    await waiting(v);
    await expect(
      withTransaction(suite.db, (tx) =>
        saveSpecialDay(
          tx,
          v.cfg,
          null,
          {
            name: "Late weekend",
            repeatsYearly: false,
            dates: [
              { date: "2026-11-06", closedAllDay: false },
              { date: "2026-11-07", closedAllDay: false },
            ],
            paint: [
              {
                departmentId: v.departmentId,
                date: "2026-11-06",
                ranges: [{ periodId: v.periodId, ...range("01:00", "03:00") }],
              },
              {
                departmentId: v.departmentId,
                date: "2026-11-07",
                ranges: [{ periodId: v.periodId, ...range("03:00", "04:00") }],
              },
            ],
          },
          at,
          1,
        ),
      ),
    ).rejects.toMatchObject({
      code: "hours.clock_change_conflict",
      params: {
        dayCutover: "03:00",
        timeZone: "Europe/Madrid",
        startsAt: "2026-11-04T02:00:00.000Z",
        conflictCount: 2,
        conflicts: expect.arrayContaining([
          expect.objectContaining({
            specialDayName: "Late weekend",
            date: "2026-11-06",
            startsAt: "01:00",
            endsAt: "03:00",
            reason: "sending_cutoff",
          }),
          expect.objectContaining({
            specialDayName: "Late weekend",
            date: "2026-11-07",
            startsAt: "03:00",
            endsAt: "04:00",
            reason: "endpoint_day",
          }),
        ]),
      },
    });
    expect(await specialDayNames(v)).toEqual([]);
  });
  it("refuses deleting a special day while another holds a clash, and deletes the clashing one", async () => {
    const v = await fixture([]);
    const [clashing, clean] = await withTransaction(suite.db, async (tx) => [
      await paintedDay(tx, v, {
        name: "Fiesta",
        date: "2026-11-20",
        ranges: [{ periodId: v.periodId, startsAt: "22:00", endsAt: "04:30" }],
      }),
      await paintedDay(tx, v, {
        name: "Market",
        date: "2026-12-10",
        ranges: [{ periodId: v.periodId, startsAt: "09:00", endsAt: "17:00" }],
      }),
    ]);
    await waiting(v);
    await expect(removeSpecialDay(v, clean!)).rejects.toMatchObject({
      code: "hours.clock_change_conflict",
      params: {
        dayCutover: "03:00",
        timeZone: "Europe/Madrid",
        startsAt: "2026-11-04T02:00:00.000Z",
        conflictCount: 1,
        conflicts: [
          expect.objectContaining({
            specialDayId: clashing,
            specialDayName: "Fiesta",
            date: "2026-11-20",
            startsAt: "22:00",
            endsAt: "04:30",
            reason: "range",
          }),
        ],
      },
    });
    expect(await specialDayNames(v)).toEqual(["Fiesta", "Market"]);
    await expect(removeSpecialDay(v, clashing!)).resolves.toBeUndefined();
    expect(await specialDayNames(v)).toEqual(["Market"]);
  });
  it("answers a special-day delete whose last orders clash only under the waiting start as a waiting-change conflict", async () => {
    const v = await fixture([], { offset: 30 });
    const clean = await withTransaction(suite.db, async (tx) => {
      await seasonDay(tx, { ...v, weekday: 5, ranges: [range("01:00", "03:00")] });
      await seasonDay(tx, { ...v, weekday: 6, ranges: [range("03:00", "04:00")] });
      return paintedDay(tx, v, { name: "Market", date: "2026-12-10", ranges: [] });
    });
    await waiting(v);
    await expect(removeSpecialDay(v, clean)).rejects.toMatchObject({
      code: "hours.clock_change_conflict",
      params: offsetClash,
    });
    expect(await specialDayNames(v)).toEqual(["Market"]);
  });
  it("refuses adding a season while a stored range clashes, since the new season copies it, and adds one when none does", async () => {
    const clash = { weekday: 6, startsAt: "21:00", endsAt: "04:30", reason: "range" };
    const v = await fixture([]);
    await withTransaction(suite.db, (tx) =>
      seasonDay(tx, { ...v, weekday: 6, ranges: [range("21:00", "04:30")] }),
    );
    await waiting(v);
    await expect(addSeason(v)).rejects.toMatchObject({
      code: "hours.clock_change_conflict",
      params: {
        dayCutover: "03:00",
        timeZone: "Europe/Madrid",
        startsAt: "2026-11-04T02:00:00.000Z",
        conflictCount: 1,
        conflicts: [
          expect.objectContaining({ seasonName: "Summer", ...clash }),
          expect.objectContaining({ seasonName: "Winter", ...clash }),
        ],
      },
    });
    expect(await seasonNames(v)).toEqual(["Winter"]);

    const fits = await fixture([range("09:00", "17:00")]);
    await waiting(fits);
    await expect(addSeason(fits)).resolves.toHaveLength(2);
    expect(await seasonNames(fits)).toEqual(["Summer", "Winter"]);
  });
  it("answers a season save whose last orders clash only under the waiting start as a waiting-change conflict", async () => {
    const v = await fixture([], { offset: 30 });
    await withTransaction(suite.db, async (tx) => {
      await seasonDay(tx, { ...v, weekday: 5, ranges: [range("01:00", "03:00")] });
      await seasonDay(tx, { ...v, weekday: 6, ranges: [range("03:00", "04:00")] });
    });
    await waiting(v);
    await expect(
      withTransaction(suite.db, (tx) =>
        saveSeasons(
          tx,
          v.cfg,
          {
            save: [{ id: v.seasonId, name: "Winter", startsOn: "01-01", colour: "blue" }],
            delete: [],
          },
          at,
          1,
        ),
      ),
    ).rejects.toMatchObject({ code: "hours.clock_change_conflict", params: offsetClash });
    expect(
      await withTransaction(suite.db, async (tx) => (await readSeasons(tx, v.cfg))[0]!.startsOn),
    ).toBe("12-01");
  });
});

describe("settledClock", () => {
  const clock: BusinessDayClock = {
    ...before,
    cutoverChanges: [
      { effectiveBusinessDay: "2026-11-01", dayCutover: "04:00" },
      { effectiveBusinessDay: E, dayCutover: "03:00" },
    ],
  };
  it("drops a change whose changeover is after the moment and keeps one at or before it", () => {
    expect(settledClock(clock, at).cutoverChanges).toEqual([
      { effectiveBusinessDay: "2026-11-01", dayCutover: "04:00" },
    ]);
    expect(settledClock(clock, new Date("2026-11-04T02:00:00.000Z")).cutoverChanges).toEqual(
      clock.cutoverChanges,
    );
    expect(settledClock(clock, new Date("2026-11-04T01:59:59.999Z")).cutoverChanges).toHaveLength(
      1,
    );
  });
});

describe("inForceClock", () => {
  const clock: BusinessDayClock = {
    ...before,
    cutoverChanges: [
      { effectiveBusinessDay: "2026-11-01", dayCutover: "04:00" },
      { effectiveBusinessDay: E, dayCutover: "03:00" },
    ],
  };
  it("is the start in force at the moment, with no changes", () => {
    expect(inForceClock(clock, new Date("2026-10-31T12:00:00Z"))).toEqual(before);
    expect(inForceClock(clock, at)).toEqual({ ...before, dayCutover: "04:00" });
    expect(inForceClock(clock, new Date("2026-11-04T01:59:59.999Z")).dayCutover).toBe("04:00");
    expect(inForceClock(clock, new Date("2026-11-04T02:00:00.000Z")).dayCutover).toBe("03:00");
  });
});

describe("undated hours are checked against the start in force", () => {
  /** 05:00, then 03:00 from 2026-10-21, then 05:00 again from 2026-10-28. */
  async function hoursBack(v: { cfg: { locationId: ReturnType<typeof locationId> } }) {
    await withTransaction(suite.db, async (tx) => {
      await tx
        .insert(locationBusinessDaySettings)
        .values({ locationId: v.cfg.locationId, revision: 1 });
      await tx.insert(locationDayCutoverChanges).values([
        {
          locationId: v.cfg.locationId,
          effectiveBusinessDay: "2026-10-21",
          dayCutover: "03:00:00",
        },
        {
          locationId: v.cfg.locationId,
          effectiveBusinessDay: "2026-10-28",
          dayCutover: "05:00:00",
        },
      ]);
    });
  }
  /** 05:00, then 03:00 from 2026-10-21. */
  async function startMovedBack(v: { cfg: { locationId: ReturnType<typeof locationId> } }) {
    await withTransaction(suite.db, async (tx) => {
      await tx
        .insert(locationBusinessDaySettings)
        .values({ locationId: v.cfg.locationId, revision: 1 });
      await tx.insert(locationDayCutoverChanges).values({
        locationId: v.cfg.locationId,
        effectiveBusinessDay: "2026-10-21",
        dayCutover: "03:00:00",
      });
    });
  }
  const whileThreeInForce = new Date("2026-10-25T12:00:00Z");
  const wednesday = <T>(entries: T[]) =>
    Array.from({ length: 7 }, (_, weekday) => (weekday === 3 ? entries : []));
  const menuWeek = (v: Awaited<ReturnType<typeof fixture>>, ranges: ReturnType<typeof range>[]) =>
    wednesday(ranges.map((r) => ({ periodId: v.periodId, ...r }))).map((slots, weekday) => ({
      weekday,
      slots,
    }));
  const zoneWeek = (ranges: ReturnType<typeof range>[]) =>
    wednesday(ranges).map((entries, weekday) => ({ weekday, ranges: entries }));
  const writeWeek = (
    v: Awaited<ReturnType<typeof fixture>>,
    ranges: ReturnType<typeof range>[],
    when = at,
  ) =>
    withTransaction(suite.db, (tx) =>
      replaceMenuWeek(tx, v.cfg, v.departmentId, menuWeek(v, ranges), when, 1),
    );
  const saveSeasonWeek = (
    v: Awaited<ReturnType<typeof fixture>>,
    week: Parameters<typeof saveSeasonWeeks>[3],
  ) => withTransaction(suite.db, (tx) => saveSeasonWeeks(tx, v.cfg, v.seasonId, week, at, 1));
  /** A Wednesday night to 04:30 with last orders 30 minutes later: it meets 05:00 exactly, and
   *  ran into 03:00 while that start was in force. */
  async function lateLastOrders() {
    const v = await fixture([range("22:00", "04:30")], { offset: 30 });
    await hoursBack(v);
    return v;
  }

  it("accepts a menu week fitting the start in force though it crossed an earlier start", async () => {
    const v = await fixture([]);
    await hoursBack(v);
    await expect(writeWeek(v, [range("22:00", "04:30")])).resolves.toBeUndefined();
  });
  it("accepts a whole day from the start in force", async () => {
    const v = await fixture([]);
    await hoursBack(v);
    await expect(writeWeek(v, [range("05:00", "05:00")])).resolves.toBeUndefined();
  });
  it("accepts a night fitting every start", async () => {
    const v = await fixture([]);
    await hoursBack(v);
    await expect(writeWeek(v, [range("22:00", "02:30")])).resolves.toBeUndefined();
  });
  it("accepts last orders that fit the start in force though they ran into an earlier start", async () => {
    const v = await fixture([], { offset: 30 });
    await hoursBack(v);
    await expect(writeWeek(v, [range("22:00", "04:30")])).resolves.toBeUndefined();
  });
  it("refuses a menu week crossing the start in force while the earlier start is in force", async () => {
    const v = await fixture([]);
    await hoursBack(v);
    await expect(writeWeek(v, [range("22:00", "04:30")], whileThreeInForce)).rejects.toMatchObject({
      code: "menu_timetable.invalid",
      params: { reason: "order" },
    });
  });
  it("accepts a zone week fitting the start in force though it crossed an earlier start", async () => {
    const v = await fixture([], { zone: true });
    await hoursBack(v);
    await expect(
      withTransaction(suite.db, (tx) =>
        replaceZoneClosedWeek(tx, v.cfg, v.zoneId!, zoneWeek([range("22:00", "04:30")]), 1, at),
      ),
    ).resolves.toBeUndefined();
  });
  it("accepts season weeks fitting the start in force though they crossed an earlier start", async () => {
    const v = await fixture([], { zone: true });
    await hoursBack(v);
    await expect(
      saveSeasonWeek(v, {
        departments: [
          { departmentId: v.departmentId, days: menuWeek(v, [range("22:00", "04:30")]) },
        ],
      }),
    ).resolves.toBeUndefined();
    await expect(
      saveSeasonWeek(v, {
        zones: [{ zoneId: v.zoneId!, days: zoneWeek([range("22:00", "04:30")]) }],
      }),
    ).resolves.toBeUndefined();
  });
  it("accepts a season week whose last orders fit the start in force", async () => {
    const v = await fixture([], { offset: 30 });
    await hoursBack(v);
    await expect(
      saveSeasonWeek(v, {
        departments: [
          { departmentId: v.departmentId, days: menuWeek(v, [range("22:00", "04:30")]) },
        ],
      }),
    ).resolves.toBeUndefined();
  });
  it("accepts an offset whose last orders fit the start in force", async () => {
    const v = await fixture([range("22:00", "04:30")]);
    await hoursBack(v);
    await expect(
      withTransaction(suite.db, (tx) =>
        updateMenuPeriod(tx, v.cfg, v.periodId, { endOffsetMinutes: 30 }, 1, at),
      ),
    ).resolves.toBeUndefined();
  });
  it("checks last orders against the start in force after a special-day save and delete", async () => {
    const v = await lateLastOrders();
    await expect(
      paintDate(v, "menu", "2026-12-25", [range("09:00", "17:00")], at, 1),
    ).resolves.toBeUndefined();
    const [day] = await withTransaction(suite.db, (tx) =>
      tx
        .select({ id: specialDays.id })
        .from(specialDays)
        .where(eq(specialDays.locationId, v.cfg.locationId)),
    );
    await expect(
      withTransaction(suite.db, (tx) => deleteSpecialDay(tx, v.cfg, day!.id, at, 1)),
    ).resolves.toBeUndefined();
  });
  it("checks last orders against the start in force after a season save", async () => {
    const v = await lateLastOrders();
    await expect(
      withTransaction(suite.db, (tx) =>
        saveSeasons(
          tx,
          v.cfg,
          {
            save: [{ id: v.seasonId, name: "Winter", startsOn: "01-01", colour: "blue" }],
            delete: [],
          },
          at,
          1,
        ),
      ),
    ).resolves.toBeDefined();
  });
  it("checks last orders against the start in force after a period delete", async () => {
    const v = await lateLastOrders();
    const other = randomUUID();
    await withTransaction(suite.db, async (tx) => {
      const [period] = await tx
        .select({ menuId: menuPeriods.menuId })
        .from(menuPeriods)
        .where(eq(menuPeriods.id, v.periodId));
      await tx.insert(menuPeriods).values({
        id: other,
        departmentId: v.departmentId,
        menuId: period!.menuId,
        name: "Other",
        endOffsetMinutes: 0,
      });
    });
    await expect(
      withTransaction(suite.db, (tx) => deletePeriod(tx, v.cfg, other, null, at, 1)),
    ).resolves.toBeUndefined();
  });
  it("leaves a past one-off date to its own start when another week is saved", async () => {
    const v = await fixture([], { offset: 30 });
    await hoursBack(v);
    await paintDate(v, "menu", "2026-10-23", [range("03:00", "04:30")], whileThreeInForce, 1);
    await paintDate(v, "menu", "2026-10-24", [range("05:00", "06:00")], whileThreeInForce, 1);
    const monday = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      slots: weekday === 1 ? [{ periodId: v.periodId, ...range("12:00", "14:00") }] : [],
    }));
    await expect(
      withTransaction(suite.db, (tx) => replaceMenuWeek(tx, v.cfg, v.departmentId, monday, at, 1)),
    ).resolves.toBeUndefined();
  });
  it("leaves the weekly ranges out beside a past one-off date when the week is saved", async () => {
    const v = await fixture([], { offset: 30 });
    await hoursBack(v);
    await paintDate(v, "menu", "2026-10-22", [range("03:00", "04:00")], whileThreeInForce, 1);
    await expect(writeWeek(v, [range("22:00", "04:30")])).resolves.toBeUndefined();
  });
  it("joins a replaced period's touching ranges in order from the start in force", async () => {
    const v = await fixture([]);
    const other = randomUUID();
    await withTransaction(suite.db, async (tx) => {
      const [period] = await tx
        .select({ menuId: menuPeriods.menuId })
        .from(menuPeriods)
        .where(eq(menuPeriods.id, v.periodId));
      await tx.insert(menuPeriods).values({
        id: other,
        departmentId: v.departmentId,
        menuId: period!.menuId,
        name: "Other",
        endOffsetMinutes: 0,
      });
      const dayId = randomUUID();
      await tx
        .insert(departmentDays)
        .values({ id: dayId, departmentId: v.departmentId, seasonId: v.seasonId, weekday: 4 });
      await tx.insert(departmentDayRanges).values([
        {
          dayId,
          departmentId: v.departmentId,
          periodId: v.periodId,
          startsAt: "04:30:00",
          endsAt: "05:00:00",
        },
        {
          dayId,
          departmentId: v.departmentId,
          periodId: other,
          startsAt: "05:00:00",
          endsAt: "06:00:00",
        },
      ]);
    });
    await startMovedBack(v);
    await withTransaction(suite.db, (tx) => deletePeriod(tx, v.cfg, other, v.periodId, at, 1));
    const rows = await withTransaction(suite.db, (tx) =>
      tx
        .select({ startsAt: departmentDayRanges.startsAt, endsAt: departmentDayRanges.endsAt })
        .from(departmentDayRanges)
        .where(eq(departmentDayRanges.departmentId, v.departmentId)),
    );
    expect(rows).toEqual([{ startsAt: "04:30:00", endsAt: "06:00:00" }]);
  });
});

it("hours models carry the baseline timeline, revision and pending status across activation", async () => {
  const v = await fixture([]);
  await withTransaction(suite.db, async (tx) => {
    await tx
      .insert(locationBusinessDaySettings)
      .values({ locationId: v.cfg.locationId, revision: 2 });
    await tx
      .insert(locationDayCutoverChanges)
      .values({ locationId: v.cfg.locationId, effectiveBusinessDay: E, dayCutover: "07:00:00" });
  });
  const read = (time: string) =>
    withTransaction(suite.db, (tx) => readOpeningHoursModel(tx, v.cfg, new Date(time)));
  const waiting = await read("2026-11-03T12:00:00Z");
  expect(waiting).toMatchObject({
    businessDayClock: candidate("07:00"),
    clockRevision: 2,
    currentBusinessDay: "2026-11-03",
  });
  expect(waiting.pending).toEqual({
    effectiveBusinessDay: E,
    dayCutover: "07:00",
    startsAt: "2026-11-04T06:00:00.000Z",
  });
  expect(await read("2026-11-04T06:00:00Z")).toMatchObject({
    businessDayClock: candidate("07:00"),
    dayCutover: "07:00",
    clockRevision: 2,
    currentBusinessDay: E,
    pending: null,
  });
});

describe("schedule authoring retains date-specific starts", () => {
  async function activated(v: Awaited<ReturnType<typeof fixture>>) {
    await withTransaction(suite.db, async (tx) => {
      await tx
        .insert(locationBusinessDaySettings)
        .values({ locationId: v.cfg.locationId, revision: 1 });
      await tx
        .insert(locationDayCutoverChanges)
        .values({ locationId: v.cfg.locationId, effectiveBusinessDay: E, dayCutover: "07:00:00" });
    });
  }
  const after = new Date("2026-11-05T12:00:00Z");
  it("checks a normal menu week against the 07:00 start in force", async () => {
    const v = await fixture([]);
    await activated(v);
    const week = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      slots: weekday === 3 ? [{ periodId: v.periodId, ...range("06:00", "08:00") }] : [],
    }));
    await expect(
      withTransaction(suite.db, (tx) => replaceMenuWeek(tx, v.cfg, v.departmentId, week, after, 1)),
    ).rejects.toMatchObject({ code: "menu_timetable.invalid" });
  });
  it("checks a normal zone week against the 07:00 start in force", async () => {
    const v = await fixture([], { zone: true });
    await activated(v);
    const week = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      ranges: weekday === 3 ? [range("06:00", "08:00")] : [],
    }));
    await expect(
      withTransaction(suite.db, (tx) =>
        replaceZoneClosedWeek(tx, v.cfg, v.zoneId!, week, 1, after),
      ),
    ).rejects.toMatchObject({ code: "zone_closed_time.invalid" });
  });
  it("accepts a one-off menu day under its own 07:00 start", async () => {
    const v = await fixture([]);
    await activated(v);
    await expect(
      paintDate(v, "menu", "2026-12-25", [range("07:00", "07:00")], after, 1),
    ).resolves.toBeUndefined();
  });
  it("accepts a one-off zone day under its own 07:00 start", async () => {
    const v = await fixture([], { zone: true });
    await activated(v);
    await expect(
      paintDate(v, "zone", "2026-12-25", [range("07:00", "07:00")], after, 1),
    ).resolves.toBeUndefined();
  });
  it("checks annual menu ranges against the start in force", async () => {
    const v = await fixture([]);
    await activated(v);
    await expect(
      paintDate(v, "menu", "2026-12-25", [range("07:00", "07:00")], after, 1, true),
    ).resolves.toBeUndefined();
    await expect(
      paintDate(v, "menu", "2026-12-26", [range("06:00", "08:00")], after, 1, true),
    ).rejects.toMatchObject({ code: "special_day.invalid", params: { field: "paint.0.ranges" } });
  });
  it("checks annual zone ranges against the start in force", async () => {
    const v = await fixture([], { zone: true });
    await activated(v);
    await expect(
      paintDate(v, "zone", "2026-12-25", [range("07:00", "07:00")], after, 1, true),
    ).resolves.toBeUndefined();
    await expect(
      paintDate(v, "zone", "2026-12-26", [range("06:00", "08:00")], after, 1, true),
    ).rejects.toMatchObject({
      code: "special_day.invalid",
      params: { field: "zonePaint.0.ranges" },
    });
  });
});

describe("dated calendar authoring after activation", () => {
  const after = new Date("2026-11-05T12:00:00Z");
  async function activated(v: Awaited<ReturnType<typeof fixture>>) {
    await withTransaction(suite.db, async (tx) => {
      await tx
        .insert(locationBusinessDaySettings)
        .values({ locationId: v.cfg.locationId, revision: 1 });
      await tx
        .insert(locationDayCutoverChanges)
        .values({ locationId: v.cfg.locationId, effectiveBusinessDay: E, dayCutover: "07:00:00" });
    });
  }
  it("allows a one-off all-day range with a negative offset under its own start", async () => {
    const v = await fixture([], { offset: -1 });
    await activated(v);
    await expect(
      paintDate(v, "menu", "2026-12-25", [range("07:00", "07:00")], after, 1),
    ).resolves.toBeUndefined();
  });
  it("accepts a skipped final boundary at the reporting boundary instant", async () => {
    const v = await fixture([]);
    await withTransaction(suite.db, (tx) =>
      tx
        .update(locations)
        .set({ dayCutover: "02:30:00" })
        .where(eq(locations.id, v.cfg.locationId)),
    );
    await expect(
      paintDate(
        v,
        "menu",
        "2026-03-28",
        [range("09:00", "02:30")],
        new Date("2026-03-20T12:00:00Z"),
        0,
      ),
    ).resolves.toBeUndefined();
  });
});

describe("clock compatibility resolves neighboring special-day substitutions", () => {
  async function neighbor(emptyOverride: boolean, closedAllDay: boolean) {
    const v = await fixture([range("22:00", "04:30")], { offset: 180, date: E });
    await withTransaction(suite.db, async (tx) => {
      await seasonDay(tx, {
        departmentId: v.departmentId,
        seasonId: v.seasonId,
        weekday: 4,
        periodId: v.periodId,
        ranges: [range("07:15", "09:00")],
      });
      await paintedDay(tx, v, {
        name: "Neighbor",
        date: "2026-11-05",
        closedAllDay,
        ranges: emptyOverride ? [{ periodId: null, startsAt: "07:15", endsAt: "09:00" }] : [],
      });
    });
    return v;
  }
  it.each([
    [true, false],
    [false, true],
  ])("honors an empty override or closed neighbor (%s,%s)", async (emptyOverride, closedAllDay) => {
    await expect(
      check(await neighbor(emptyOverride, closedAllDay), "07:00"),
    ).resolves.toBeUndefined();
  });
  it("includes the next occurrence of an annual override beside a normal week", async () => {
    const v = await fixture([range("22:00", "04:30")], { offset: 180 });
    await withTransaction(suite.db, (tx) =>
      paintedDay(tx, v, {
        name: "Annual neighbor",
        date: "2025-11-05",
        repeatsYearly: true,
        ranges: [{ periodId: v.periodId, startsAt: "07:15", endsAt: "09:00" }],
      }),
    );
    await expect(check(v, "07:00")).rejects.toMatchObject({
      code: "venue.business_day_hours_conflict",
      params: { conflicts: [expect.objectContaining({ reason: "sending_cutoff", weekday: 3 })] },
    });
  });
});

describe("dated runtime service and yesterday sending", () => {
  async function timeline(v: Awaited<ReturnType<typeof fixture>>, time: string) {
    await withTransaction(suite.db, async (tx) => {
      await tx.insert(locationDayCutoverChanges).values({
        locationId: v.cfg.locationId,
        effectiveBusinessDay: E,
        dayCutover: `${time}:00`,
      });
    });
  }
  it.each(["07:00", "03:00"])(
    "does not replay a completed service across the %s boundary",
    async (time) => {
      const v = await writtenFixture([range("22:00", time === "07:00" ? "04:30" : "02:30")], {
        weekday: 2,
      });
      await timeline(v, time);
      const read = (instant: string) =>
        withTransaction(suite.db, (tx) =>
          resolveDepartmentService(tx, v.cfg, v.departmentId, new Date(instant)),
        );
      const instants =
        time === "07:00"
          ? ["2026-11-04T04:00:00Z", "2026-11-04T05:59:00Z"]
          : ["2026-11-04T01:59:00Z"];
      for (const instant of instants) {
        const result = await read(instant);
        expect(result.open).toBe(false);
        expect(result.orderableMenuIds).toEqual([]);
        expect(result.endedMenuIds).toHaveLength(1);
      }
      const boundary = time === "07:00" ? "2026-11-04T06:00:00Z" : "2026-11-04T02:00:00Z";
      expect(await read(boundary)).toMatchObject({
        open: false,
        orderableMenuIds: [],
      });
    },
  );
  it("after the start moves from 05:00 to 03:00, yesterday's menus are not orderable", async () => {
    const v = await writtenFixture([range("22:00", "02:30")], { weekday: 2 });
    await timeline(v, "03:00");
    for (const instant of [
      "2026-11-04T02:00:00Z",
      "2026-11-04T02:30:00Z",
      "2026-11-04T03:59:00Z",
    ]) {
      const result = await withTransaction(suite.db, (tx) =>
        resolveDepartmentService(tx, v.cfg, v.departmentId, new Date(instant)),
      );
      expect(result.orderableMenuIds).toEqual([]);
    }
  });
});

it.each([
  ["2026-10-25T00:45:00Z", "2026-10-25T01:30:00Z"],
  ["2026-03-29T01:10:00Z", "2026-03-29T01:30:00Z"],
])("keeps zone closure through the actual DST boundary at %s", async (instant, boundary) => {
  const v = await writtenFixture([range("02:30", "02:30")], {
    zone: true,
    weekday: 6,
    dayCutover: "02:30",
  });
  const read = (time: string) =>
    withTransaction(suite.db, (tx) => readZoneKeepOpenState(tx, v.cfg, v.zoneId!, new Date(time)));
  expect(await read(instant)).toMatchObject({
    running: false,
    closesAt: "02:30",
    extendedUntil: null,
  });
  expect(await read(boundary)).toBeNull();
});

it("rechecks a time writer queued before a clock change commits", async () => {
  const v = await fixture([range("09:00", "17:00")]);
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };
  const entered = deferred(),
    release = deferred(),
    queued = deferred();
  const first = withTransaction(suite.db, async (tx) => {
    entered.resolve();
    await release.promise;
    await tx
      .insert(locationBusinessDaySettings)
      .values({ locationId: v.cfg.locationId, revision: 1 });
    await tx
      .insert(locationDayCutoverChanges)
      .values({ locationId: v.cfg.locationId, effectiveBusinessDay: E, dayCutover: "07:00:00" });
  });
  await entered.promise;
  const realLock = suite.db.withWriteLock.bind(suite.db);
  const spy = vi
    .spyOn(suite.db, "withWriteLock")
    .mockImplementation(<T>(body: () => Promise<T>) => {
      queued.resolve();
      return realLock(body);
    });
  let second!: Promise<void>;
  let refused!: Promise<unknown>;
  try {
    second = withTransaction(suite.db, (tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.departmentId,
        Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          slots: weekday === 3 ? [{ periodId: v.periodId, ...range("09:00", "18:00") }] : [],
        })),
        at,
        0,
      ),
    );
    refused = expect(second).rejects.toMatchObject({ code: "hours.clock_changed" });
    await queued.promise;
  } finally {
    spy.mockRestore();
    release.resolve();
  }
  await first;
  await refused;
  const saved = await suite.db
    .select({ endsAt: departmentDayRanges.endsAt })
    .from(departmentDayRanges)
    .where(eq(departmentDayRanges.departmentId, v.departmentId));
  expect(saved).toEqual([{ endsAt: "17:00:00" }]);
});

it("identifies conflicting period and zone schedules with names and recorded ranges", async () => {
  for (const zone of [false, true]) {
    const v = await fixture([range("05:00", "05:00")], { zone, date: E });
    const result = await withTransaction(suite.db, (tx) =>
      businessDayClockConflicts(tx, v.cfg, before, candidate("03:00"), E),
    );
    expect(result.conflictCount).toBe(1);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        departmentId: v.departmentId,
        departmentName: "Service",
        date: E,
        specialDayId: v.specialDayId,
        specialDayName: "Named day",
        startsAt: "05:00",
        endsAt: "05:00",
        rangeIndex: 0,
        reason: "all_day",
        ...(zone
          ? { zoneId: v.zoneId, zoneName: "Zone" }
          : { periodId: v.periodId, periodName: "Service" }),
      }),
    ]);
  }
});

it("reports a clashing season range once per season it is painted in, naming the season", async () => {
  for (const zone of [false, true]) {
    const v = await fixture([], { zone });
    const result = await withTransaction(suite.db, async (tx) => {
      const winter = { id: v.seasonId };
      const [summer] = await tx
        .insert(seasons)
        .values({ locationId: v.cfg.locationId, name: "Summer", startsOn: "06-01" })
        .returning();
      const paint = (seasonId: string, ranges: { startsAt: string; endsAt: string }[]) => {
        const on = <T>(entries: T[]) =>
          Array.from({ length: 7 }, (_, weekday) => (weekday === 3 ? entries : []));
        return zone
          ? replaceZoneClosedWeek(
              tx,
              v.cfg,
              v.zoneId!,
              on(ranges).map((entries, weekday) => ({ weekday, ranges: entries })),
              0,
              at,
              { seasonId },
            )
          : replaceMenuWeek(
              tx,
              v.cfg,
              v.departmentId,
              on(ranges.map((r) => ({ periodId: v.periodId, ...r }))).map((slots, weekday) => ({
                weekday,
                slots,
              })),
              at,
              0,
              { seasonId },
            );
      };
      await paint(winter.id, [range("22:00", "04:30")]);
      await paint(summer!.id, [range("09:00", "17:00")]);
      const once = await businessDayClockConflicts(tx, v.cfg, before, candidate("03:00"), E);
      await paint(summer!.id, [range("22:00", "04:30")]);
      const twice = await businessDayClockConflicts(tx, v.cfg, before, candidate("03:00"), E);
      return { once, twice, winter: winter.id, summer: summer!.id };
    });
    const conflict = (seasonId: string) =>
      expect.objectContaining({
        departmentId: v.departmentId,
        seasonId,
        weekday: 3,
        startsAt: "22:00",
        endsAt: "04:30",
        reason: "range",
        ...(zone ? { zoneId: v.zoneId } : { periodId: v.periodId }),
      });
    expect(result.once).toEqual({ conflictCount: 1, conflicts: [conflict(result.winter)] });
    expect(result.twice.conflictCount).toBe(1);
    expect(result.twice.conflicts).toHaveLength(2);
    expect(result.twice.conflicts).toEqual(
      expect.arrayContaining([conflict(result.winter), conflict(result.summer)]),
    );
  }
});

it("names the season of each season range conflict", async () => {
  const v = await fixture([]);
  const result = await withTransaction(suite.db, async (tx) => {
    const [autumn] = await tx
      .insert(seasons)
      .values({ locationId: v.cfg.locationId, name: "Autumn", startsOn: "09-01" })
      .returning();
    for (const seasonId of [v.seasonId, autumn!.id])
      await replaceMenuWeek(
        tx,
        v.cfg,
        v.departmentId,
        Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          slots: weekday === 1 ? [{ periodId: v.periodId, ...range("22:00", "04:30") }] : [],
        })),
        at,
        0,
        { seasonId },
      );
    return {
      conflicts: await businessDayClockConflicts(tx, v.cfg, before, candidate("03:00"), E),
      autumn: autumn!.id,
    };
  });
  expect(result.conflicts.conflicts).toHaveLength(2);
  expect(result.conflicts.conflicts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ weekday: 1, seasonId: v.seasonId, seasonName: "Winter" }),
      expect.objectContaining({ weekday: 1, seasonId: result.autumn, seasonName: "Autumn" }),
    ]),
  );
});

it("leaves the season unnamed for a day row whose season is another venue's", async () => {
  const v = await fixture([]);
  const other = await fixture([]);
  const result = await withTransaction(suite.db, async (tx) => {
    await seasonDay(tx, {
      departmentId: v.departmentId,
      seasonId: other.seasonId,
      weekday: 1,
      periodId: v.periodId,
      ranges: [range("22:00", "04:30")],
    });
    return businessDayClockConflicts(tx, v.cfg, before, candidate("03:00"), E);
  });
  expect(result.conflicts).toHaveLength(1);
  expect(result.conflicts[0]).toMatchObject({ seasonId: other.seasonId });
  expect(result.conflicts[0]).not.toHaveProperty("seasonName");
});

it("lists a department's season conflicts in the venue's season order", async () => {
  const v = await fixture([]);
  const result = await withTransaction(suite.db, async (tx) => {
    // Ids sort in the reverse of the seasons' order, so an id order cannot pass.
    const added = [
      { id: "f0000000-0000-4000-8000-000000000000", name: "Spring", startsOn: "03-01" },
      { id: "e0000000-0000-4000-8000-000000000000", name: "Summer", startsOn: "06-01" },
      { id: "d0000000-0000-4000-8000-000000000000", name: "Autumn", startsOn: "09-01" },
    ];
    await tx.insert(seasons).values(added.map((s) => ({ ...s, locationId: v.cfg.locationId })));
    for (const seasonId of [v.seasonId, ...added.map((s) => s.id)])
      await seasonDay(tx, {
        departmentId: v.departmentId,
        seasonId,
        weekday: 1,
        periodId: v.periodId,
        ranges: [range("22:00", "04:30")],
      });
    return businessDayClockConflicts(tx, v.cfg, before, candidate("03:00"), E);
  });
  expect(result.conflicts.map((c) => c.seasonName)).toEqual([
    "Spring",
    "Summer",
    "Autumn",
    "Winter",
  ]);
});

it("checks a season's last day against the next season's first", async () => {
  const v = await fixture([range("22:00", "04:30")], { offset: 180 });
  await withTransaction(suite.db, async (tx) => {
    const [summer] = await tx
      .insert(seasons)
      .values({ locationId: v.cfg.locationId, name: "Summer", startsOn: "06-01" })
      .returning();
    await seasonDay(tx, {
      departmentId: v.departmentId,
      seasonId: summer!.id,
      weekday: 4,
      periodId: v.periodId,
      ranges: [range("07:15", "09:00")],
    });
  });
  await expect(check(v, "07:00")).rejects.toMatchObject({
    code: "venue.business_day_hours_conflict",
    params: {
      conflicts: [
        expect.objectContaining({ reason: "sending_cutoff", weekday: 3, seasonId: v.seasonId }),
      ],
    },
  });
});

it("counts a range painted in every season once, so a capped list still names every department", async () => {
  const v = await fixture([]);
  const result = await withTransaction(suite.db, async (tx) => {
    await tx.insert(seasons).values(
      [
        ["Spring", "03-01"],
        ["Summer", "06-01"],
        ["Autumn", "09-01"],
      ].map(([name, startsOn]) => ({
        locationId: v.cfg.locationId,
        name: name!,
        startsOn: startsOn!,
      })),
    );
    const secondId = randomUUID(),
      secondPeriodId = randomUUID(),
      menuId = randomUUID();
    await tx.insert(departments).values({
      id: secondId,
      locationId: v.cfg.locationId,
      name: "Bar",
      tradingName: "Bar",
    });
    await tx.insert(catalogues).values({ id: menuId, name: "Bar menu" });
    await tx
      .insert(menuPeriods)
      .values({ id: secondPeriodId, departmentId: secondId, menuId, name: "Bar" });
    for (const [departmentId, periodId] of [
      [v.departmentId, v.periodId],
      [secondId, secondPeriodId],
    ])
      await replaceMenuWeek(
        tx,
        v.cfg,
        departmentId!,
        Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          slots: [{ periodId, ...range("22:00", "04:30") }],
        })),
        at,
        0,
      );
    return {
      secondId,
      conflicts: await businessDayClockConflicts(tx, v.cfg, before, candidate("03:00"), E),
    };
  });
  expect(result.conflicts.conflictCount).toBe(14);
  expect(new Set(result.conflicts.conflicts.map((c) => c.departmentId))).toEqual(
    new Set([v.departmentId, result.secondId]),
  );
  expect(result.conflicts.conflicts).toHaveLength(56);
});

describe("clock compatibility reads each day's neighbours from its own season", () => {
  async function twoSeasons(v: Awaited<ReturnType<typeof fixture>>) {
    const [summer] = await suite.db
      .insert(seasons)
      .values({ locationId: v.cfg.locationId, name: "Summer", startsOn: "06-01" })
      .returning();
    return summer!.id;
  }
  it("checks a season weekday against the same season's next weekday", async () => {
    const v = await fixture([range("22:00", "04:30")], { offset: 180 });
    await twoSeasons(v);
    await withTransaction(suite.db, (tx) =>
      seasonDay(tx, {
        departmentId: v.departmentId,
        seasonId: v.seasonId,
        weekday: 4,
        periodId: v.periodId,
        ranges: [range("07:15", "09:00")],
      }),
    );
    await expect(check(v, "07:00")).rejects.toMatchObject({
      code: "venue.business_day_hours_conflict",
      params: {
        conflicts: [
          expect.objectContaining({ reason: "sending_cutoff", weekday: 3, seasonId: v.seasonId }),
        ],
      },
    });
  });
  it("ignores a special day whose day before is another season's weekday", async () => {
    const v = await fixture([range("22:00", "04:30")], { offset: 180 });
    await twoSeasons(v);
    // 2026-11-04, the Wednesday before, is in Summer; the painted Wednesday is Winter's.
    await withTransaction(suite.db, (tx) =>
      paintedDay(tx, v, {
        name: "Summer neighbour",
        date: "2026-11-05",
        ranges: [{ periodId: v.periodId, startsAt: "07:15", endsAt: "09:00" }],
      }),
    );
    await expect(check(v, "07:00")).resolves.toBeUndefined();
  });
  it("follows a special day with the next day's own season week", async () => {
    const v = await fixture([range("22:00", "04:30")], { offset: 180, date: E });
    await twoSeasons(v);
    // 2026-11-05 is a Summer Thursday; only Winter paints Thursday.
    await withTransaction(suite.db, (tx) =>
      seasonDay(tx, {
        departmentId: v.departmentId,
        seasonId: v.seasonId,
        weekday: 4,
        periodId: v.periodId,
        ranges: [range("07:15", "09:00")],
      }),
    );
    await expect(check(v, "07:00")).resolves.toBeUndefined();
  });
});

describe("clock compatibility reads special-day paint", () => {
  async function specialDay(
    v: Awaited<ReturnType<typeof fixture>>,
    date: string,
    ranges: { periodId: string | null; startsAt: string; endsAt: string }[],
  ) {
    return withTransaction(suite.db, (tx) => paintedDay(tx, v, { name: "Fiesta", date, ranges }));
  }
  const conflicts = (v: Awaited<ReturnType<typeof fixture>>, time: string) =>
    withTransaction(suite.db, (tx) =>
      businessDayClockConflicts(tx, v.cfg, before, candidate(time), E),
    );

  it("reports a painted range the new changeover cuts through, naming the special day", async () => {
    const v = await fixture([]);
    const specialDayId = await specialDay(v, "2026-11-20", [
      { periodId: v.periodId, startsAt: "22:00", endsAt: "04:30" },
    ]);
    expect(await conflicts(v, "03:00")).toEqual({
      conflictCount: 1,
      conflicts: [
        {
          departmentId: v.departmentId,
          departmentName: "Service",
          periodName: "Service",
          specialDayId,
          specialDayName: "Fiesta",
          date: "2026-11-20",
          periodId: v.periodId,
          startsAt: "22:00",
          endsAt: "04:30",
          rangeIndex: 0,
          reason: "range",
        },
      ],
    });
    expect(await conflicts(v, "07:00")).toEqual({ conflictCount: 0, conflicts: [] });
  });

  it("reports a Closed painted range the new changeover cuts through, with no period", async () => {
    const v = await fixture([]);
    const specialDayId = await specialDay(v, "2026-11-20", [
      { periodId: null, startsAt: "22:00", endsAt: "04:30" },
    ]);
    expect((await conflicts(v, "03:00")).conflicts).toEqual([
      {
        departmentId: v.departmentId,
        departmentName: "Service",
        specialDayId,
        specialDayName: "Fiesta",
        date: "2026-11-20",
        startsAt: "22:00",
        endsAt: "04:30",
        rangeIndex: 0,
        reason: "range",
      },
    ]);
  });

  it("reports a zone's painted range the new changeover cuts through", async () => {
    const v = await fixture([], { zone: true });
    const specialDayId = await specialDay(v, "2026-11-20", []);
    await withTransaction(suite.db, async (tx) => {
      const [date] = await tx
        .select({ id: specialDayDates.id })
        .from(specialDayDates)
        .where(eq(specialDayDates.specialDayId, specialDayId));
      const dayId = randomUUID();
      await tx
        .insert(zoneDays)
        .values({ id: dayId, zoneId: v.zoneId!, specialDayDateId: date!.id });
      await tx
        .insert(zoneDayRanges)
        .values({ dayId, kind: "closed", startsAt: "22:00:00", endsAt: "04:30:00" });
    });
    expect((await conflicts(v, "03:00")).conflicts).toEqual([
      {
        departmentId: v.departmentId,
        departmentName: "Service",
        zoneId: v.zoneId,
        zoneName: "Zone",
        specialDayId,
        specialDayName: "Fiesta",
        date: "2026-11-20",
        startsAt: "22:00",
        endsAt: "04:30",
        rangeIndex: 0,
        reason: "range",
      },
    ]);
  });

  it("ignores a one-off special day before the change", async () => {
    const v = await fixture([]);
    await specialDay(v, "2026-10-20", [
      { periodId: v.periodId, startsAt: "22:00", endsAt: "04:30" },
    ]);
    expect(await conflicts(v, "03:00")).toEqual({ conflictCount: 0, conflicts: [] });
  });

  it("follows a season day with the special day's painted next day", async () => {
    // Wednesday's range sends until 07:30; 2026-11-05 is a Thursday, empty in the season.
    const v = await fixture([range("22:00", "04:30")], { offset: 180 });
    await expect(check(v, "07:00")).resolves.toBeUndefined();
    await specialDay(v, "2026-11-05", [
      { periodId: v.periodId, startsAt: "07:15", endsAt: "09:00" },
    ]);
    await expect(check(v, "07:00")).rejects.toMatchObject({
      code: "venue.business_day_hours_conflict",
      params: { conflicts: [expect.objectContaining({ reason: "sending_cutoff", weekday: 3 })] },
    });
  });

  it("follows a special day with the next day's paint laid over its season", async () => {
    // 2026-11-19 is a Thursday whose painted range sends until 07:30; Friday's season opens at 07:15.
    const v = await fixture([], { offset: 180 });
    await withTransaction(suite.db, (tx) =>
      seasonDay(tx, {
        departmentId: v.departmentId,
        seasonId: v.seasonId,
        weekday: 5,
        periodId: v.periodId,
        ranges: [range("07:15", "09:00")],
      }),
    );
    const late = await specialDay(v, "2026-11-19", [
      { periodId: v.periodId, startsAt: "22:00", endsAt: "04:30" },
    ]);
    await expect(check(v, "07:00")).rejects.toMatchObject({
      code: "venue.business_day_hours_conflict",
      params: {
        conflicts: [expect.objectContaining({ reason: "sending_cutoff", specialDayId: late })],
      },
    });
    await specialDay(v, "2026-11-20", [{ periodId: null, startsAt: "07:15", endsAt: "09:00" }]);
    await expect(check(v, "07:00")).resolves.toBeUndefined();
  });

  it("walks a repeating special day into a one-off special day's year beyond its 400 years", async () => {
    const v = await fixture([], { offset: 180 });
    const eve = await withTransaction(suite.db, (tx) =>
      paintedDay(tx, v, {
        name: "Eve",
        date: "2026-12-24",
        repeatsYearly: true,
        ranges: [{ periodId: v.periodId, startsAt: "22:00", endsAt: "04:30" }],
      }),
    );
    await expect(check(v, "07:00")).resolves.toBeUndefined();
    await withTransaction(suite.db, (tx) =>
      paintedDay(tx, v, {
        name: "Far day",
        date: "2500-12-25",
        ranges: [{ periodId: v.periodId, startsAt: "07:15", endsAt: "09:00" }],
      }),
    );
    await expect(check(v, "07:00")).rejects.toMatchObject({
      code: "venue.business_day_hours_conflict",
      params: {
        conflicts: [expect.objectContaining({ reason: "sending_cutoff", specialDayId: eve })],
      },
    });
  });

  it("reads the special days' dates", async () => {
    const v = await fixture([], { zone: true });
    await specialDay(v, "2026-11-20", [
      { periodId: v.periodId, startsAt: "22:00", endsAt: "04:30" },
    ]);
    const statements = await withTransaction(suite.db, async (tx) => {
      const session = (
        tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
      ).session;
      const prepared = vi.spyOn(session, "prepareQuery");
      try {
        await businessDayClockConflicts(tx, v.cfg, before, candidate("03:00"), E);
        return prepared.mock.calls.map(([query]) => (query as unknown as { sql: string }).sql);
      } finally {
        prepared.mockRestore();
      }
    });
    expect(statements.filter((text) => text.includes('"special_day_dates"'))).not.toEqual([]);
  });
});

/** Four seasons, three departments and two sets of `count` yearly special days, with
 *  fixed ids so the listed conflicts come out in one order. */
async function busyCalendar(count: number, run = 0) {
  const fixed = (kind: number, n: number) =>
    `00000000-0000-4${String(run).padStart(3, "0")}-8${String(kind).padStart(3, "0")}-${String(n).padStart(12, "0")}`;
  return withTransaction(suite.db, async (tx) => {
    const loc = locationId(randomUUID());
    await tx.insert(locations).values({
      id: loc,
      name: "Busy venue",
      invoiceLocales: ["en"],
      operationDescription: "Restaurant",
      timeZone: before.timeZone,
      dayCutover: "05:00:00",
    });
    const seasonIds = ["03-01", "06-01", "09-01", "12-01"].map((startsOn, i) => ({
      id: fixed(1, i),
      startsOn,
      name: `Season ${i}`,
    }));
    for (const season of seasonIds) await tx.insert(seasons).values({ ...season, locationId: loc });
    const menuId = randomUUID();
    await tx.insert(catalogues).values({ id: menuId, name: "Menu" });
    const departmentsMade: { id: string; lunch: string; dinner: string }[] = [];
    for (let d = 0; d < 3; d++) {
      const id = fixed(2, d);
      await tx.insert(departments).values({
        id,
        locationId: loc,
        name: `Department ${d}`,
        tradingName: `Department ${d}`,
      });
      const lunch = fixed(3, d * 2),
        dinner = fixed(3, d * 2 + 1);
      await tx.insert(menuPeriods).values([
        { id: lunch, departmentId: id, menuId, name: `Lunch ${d}`, endOffsetMinutes: 30 },
        { id: dinner, departmentId: id, menuId, name: `Dinner ${d}`, endOffsetMinutes: 120 },
      ]);
      departmentsMade.push({ id, lunch, dinner });
      for (const season of seasonIds)
        for (let weekday = 0; weekday < 7; weekday++) {
          const dayId = randomUUID();
          await tx
            .insert(departmentDays)
            .values({ id: dayId, departmentId: id, seasonId: season.id, weekday });
          await tx.insert(departmentDayRanges).values([
            { dayId, departmentId: id, periodId: lunch, startsAt: "12:00:00", endsAt: "15:00:00" },
            {
              dayId,
              departmentId: id,
              periodId: dinner,
              startsAt: weekday === 6 ? "21:00:00" : "20:00:00",
              endsAt: weekday === 6 ? "03:45:00" : "23:30:00",
            },
          ]);
        }
    }
    const date = (month: number, day: number) =>
      `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    for (let i = 0; i < count; i++) {
      const namedId = fixed(4, i),
        namedDateId = fixed(8, i),
        namedDayId = fixed(9, i);
      await tx
        .insert(specialDays)
        .values({ id: namedId, locationId: loc, name: `Named ${i}`, repeatsYearly: true });
      await tx.insert(specialDayDates).values({
        id: namedDateId,
        specialDayId: namedId,
        locationId: loc,
        date: date((i % 12) + 1, 2 + (i % 14)),
        closedAllDay: i % 5 === 4,
      });
      await tx.insert(departmentDays).values({
        id: namedDayId,
        departmentId: departmentsMade[0]!.id,
        specialDayDateId: namedDateId,
      });
      await tx.insert(departmentDayRanges).values({
        dayId: namedDayId,
        departmentId: departmentsMade[0]!.id,
        periodId: departmentsMade[0]!.lunch,
        startsAt: "05:15:00",
        endsAt: "09:00:00",
      });
      const specialDayId = fixed(5, i),
        dateId = fixed(6, i);
      await tx
        .insert(specialDays)
        .values({ id: specialDayId, locationId: loc, name: `Special ${i}`, repeatsYearly: true });
      await tx.insert(specialDayDates).values({
        id: dateId,
        specialDayId,
        locationId: loc,
        date: date((i % 12) + 1, 1 + (i % 14)),
        closedAllDay: i % 7 === 6,
      });
      for (const [d, department] of departmentsMade.entries()) {
        const dayId = fixed(7, i * 3 + d);
        await tx
          .insert(departmentDays)
          .values({ id: dayId, departmentId: department.id, specialDayDateId: dateId });
        await tx.insert(departmentDayRanges).values([
          {
            dayId,
            departmentId: department.id,
            periodId: department.dinner,
            startsAt: "20:00:00",
            endsAt: "03:30:00",
          },
          ...(i % 3 === 0
            ? [
                {
                  dayId,
                  departmentId: department.id,
                  periodId: null,
                  startsAt: "12:00:00",
                  endsAt: "15:00:00",
                },
              ]
            : []),
        ]);
      }
    }
    return { locationId: loc };
  });
}

it("lists the same conflicts for many yearly special days", async () => {
  const cfg = await busyCalendar(50);
  const result = await withTransaction(suite.db, (tx) =>
    businessDayClockConflicts(tx, cfg, before, candidate("04:00"), E),
  );
  const lines = result.conflicts.map((c) =>
    [
      c.departmentName,
      c.specialDayName ?? c.seasonName,
      c.date ?? c.weekday,
      c.periodName ?? "Closed",
      `${c.startsAt}-${c.endsAt}`,
      c.rangeIndex,
      c.reason,
    ].join(" | "),
  );
  expect(result.conflictCount).toBe(41);
  expect(lines).toEqual([
    "Department 0 | Season 0 | 6 | Dinner 0 | 21:00-03:45 | 1 | sending_cutoff",
    "Department 0 | Season 1 | 6 | Dinner 0 | 21:00-03:45 | 1 | sending_cutoff",
    "Department 0 | Season 2 | 6 | Dinner 0 | 21:00-03:45 | 1 | sending_cutoff",
    "Department 0 | Season 3 | 6 | Dinner 0 | 21:00-03:45 | 1 | sending_cutoff",
    "Department 0 | Special 0 | 2026-01-01 | Dinner 0 | 20:00-03:30 | 1 | sending_cutoff",
    "Department 0 | Special 1 | 2026-02-02 | Dinner 0 | 20:00-03:30 | 0 | sending_cutoff",
    "Department 0 | Special 2 | 2026-03-03 | Dinner 0 | 20:00-03:30 | 0 | sending_cutoff",
    "Department 0 | Special 3 | 2026-04-04 | Dinner 0 | 20:00-03:30 | 1 | sending_cutoff",
    "Department 0 | Special 5 | 2026-06-06 | Dinner 0 | 20:00-03:30 | 0 | sending_cutoff",
    "Department 0 | Special 6 | 2026-07-07 | Dinner 0 | 20:00-03:30 | 1 | sending_cutoff",
    "Department 0 | Special 7 | 2026-08-08 | Dinner 0 | 20:00-03:30 | 0 | sending_cutoff",
    "Department 0 | Special 8 | 2026-09-09 | Dinner 0 | 20:00-03:30 | 0 | sending_cutoff",
    "Department 0 | Special 10 | 2026-11-11 | Dinner 0 | 20:00-03:30 | 0 | sending_cutoff",
    "Department 0 | Special 11 | 2026-12-12 | Dinner 0 | 20:00-03:30 | 0 | sending_cutoff",
    "Department 0 | Special 12 | 2026-01-13 | Dinner 0 | 20:00-03:30 | 1 | sending_cutoff",
    "Department 0 | Special 13 | 2026-02-14 | Dinner 0 | 20:00-03:30 | 0 | sending_cutoff",
    "Department 0 | Special 15 | 2026-04-02 | Dinner 0 | 20:00-03:30 | 1 | sending_cutoff",
    "Department 0 | Special 16 | 2026-05-03 | Dinner 0 | 20:00-03:30 | 0 | sending_cutoff",
    "Department 0 | Special 17 | 2026-06-04 | Dinner 0 | 20:00-03:30 | 0 | sending_cutoff",
    "Department 0 | Special 18 | 2026-07-05 | Dinner 0 | 20:00-03:30 | 1 | sending_cutoff",
    "Department 0 | Special 20 | 2026-09-07 | Dinner 0 | 20:00-03:30 | 0 | sending_cutoff",
    "Department 0 | Special 21 | 2026-10-08 | Dinner 0 | 20:00-03:30 | 1 | sending_cutoff",
    "Department 0 | Special 22 | 2026-11-09 | Dinner 0 | 20:00-03:30 | 0 | sending_cutoff",
  ]);
});

describe("a keep-open for the night before the change", () => {
  const keptOpen = async (endsAt: string, zone = false, businessDay = "2026-11-03") => {
    const v = await fixture([], { zone });
    await withTransaction(suite.db, async (tx) => {
      if (zone)
        await tx.insert(zoneExtensions).values({
          zoneId: v.zoneId!,
          businessDay,
          startsAt: "22:00:00",
          endsAt: `${endsAt}:00`,
        });
      else
        await tx.insert(periodExtensions).values({
          departmentId: v.departmentId,
          periodId: v.periodId,
          businessDay,
          startsAt: "22:00:00",
          endsAt: `${endsAt}:00`,
        });
    });
    return v;
  };

  it("clashes when it runs past the new changeover", async () => {
    const v = await keptOpen("04:30");
    const conflicts = await withTransaction(suite.db, (tx) =>
      keptOpenConflicts(tx, v.cfg, before, candidate("03:00"), E),
    );
    expect(conflicts).toEqual([
      {
        departmentId: v.departmentId,
        departmentName: "Service",
        periodId: v.periodId,
        periodName: "Service",
        endsAt: "04:30",
        rangeIndex: 0,
        reason: "kept_open",
      },
    ]);
  });

  it("does not clash when it ends before the new changeover", async () => {
    const v = await keptOpen("02:30");
    const conflicts = await withTransaction(suite.db, (tx) =>
      keptOpenConflicts(tx, v.cfg, before, candidate("03:00"), E),
    );
    expect(conflicts).toEqual([]);
  });

  it("names the zone a zone keep-open belongs to", async () => {
    const v = await keptOpen("04:30", true);
    const conflicts = await withTransaction(suite.db, (tx) =>
      keptOpenConflicts(tx, v.cfg, before, candidate("03:00"), E),
    );
    expect(conflicts).toEqual([
      {
        departmentId: v.departmentId,
        departmentName: "Service",
        zoneId: v.zoneId,
        zoneName: "Zone",
        endsAt: "04:30",
        rangeIndex: 0,
        reason: "kept_open",
      },
    ]);
  });

  it("clashes when it runs to the old changeover", async () => {
    const v = await keptOpen("05:00");
    const conflicts = await withTransaction(suite.db, (tx) =>
      keptOpenConflicts(tx, v.cfg, before, candidate("03:00"), E),
    );
    expect(conflicts).toEqual([expect.objectContaining({ endsAt: "05:00", reason: "kept_open" })]);
  });

  it("does not clash when it ends exactly at the new changeover", async () => {
    const v = await keptOpen("03:00");
    const conflicts = await withTransaction(suite.db, (tx) =>
      keptOpenConflicts(tx, v.cfg, before, candidate("03:00"), E),
    );
    expect(conflicts).toEqual([]);
  });

  it("ignores a keep-open for another night", async () => {
    for (const zone of [false, true]) {
      const v = await keptOpen("04:30", zone, "2026-11-02");
      const conflicts = await withTransaction(suite.db, (tx) =>
        keptOpenConflicts(tx, v.cfg, before, candidate("03:00"), E),
      );
      expect(conflicts).toEqual([]);
    }
  });

  it("ignores another venue's keep-open", async () => {
    for (const zone of [false, true]) {
      await keptOpen("04:30", zone);
      const other = await fixture([], { zone });
      const conflicts = await withTransaction(suite.db, (tx) =>
        keptOpenConflicts(tx, other.cfg, before, candidate("03:00"), E),
      );
      expect(conflicts).toEqual([]);
    }
  });

  it("refuses the change with the keep-open in the list and the count", async () => {
    const v = await keptOpen("04:30");
    const refusal = await withTransaction(suite.db, (tx) =>
      assertBusinessDayClockChange(tx, v.cfg, before, candidate("03:00"), E),
    ).catch((error: unknown) => error);
    expect(refusal).toMatchObject({
      code: "venue.business_day_hours_conflict",
      params: {
        conflictCount: 1,
        conflicts: [expect.objectContaining({ reason: "kept_open", endsAt: "04:30" })],
      },
    });
  });
});
