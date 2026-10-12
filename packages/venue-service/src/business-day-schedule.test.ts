import { readZoneKeepOpenState } from "./operations.js";
import { replaceZoneClosedWeek, saveZoneClosedDate } from "./zone-closed-times.js";
import {
  replaceMenuWeek,
  saveSpecialDateMenus,
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
import { menuDayTimetables, menuPeriods, menuSlots } from "./schema/menus.js";
import { specialDates } from "./schema/hours.js";
import { zoneClosedTimes } from "./schema/zone-closed-times.js";
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
} from "./business-day-schedule.js";

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
    const specialDateId = options.date === undefined ? undefined : randomUUID();
    if (specialDateId !== undefined)
      await tx.insert(specialDates).values({
        id: specialDateId,
        locationId: loc,
        date: options.date!,
        name: "Named day",
        repeatOn: options.annual ? options.date!.slice(5) : null,
        ownHours: true,
        closeWholeVenue: options.closed ?? false,
      });
    let zoneId: string | undefined;
    if (options.zone) {
      zoneId = randomUUID();
      await tx
        .insert(floorZones)
        .values({ id: zoneId, locationId: loc, name: "Zone", active: !options.disabled });
      await tx.insert(zoneServicePolicies).values({ zoneId, locationId: loc, departmentId });
      if (ranges.length && specialDateId)
        await tx.insert(zoneClosedTimes).values(
          ranges.map((r) => ({
            zoneId: zoneId!,
            weekday: null,
            specialDateId,
            startsAt: `${r.startsAt}:00`,
            endsAt: `${r.endsAt}:00`,
          })),
        );
      else if (ranges.length) {
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
    } else if (specialDateId) {
      const timetableId = randomUUID();
      await tx.insert(menuDayTimetables).values({
        id: timetableId,
        departmentId,
        weekday: null,
        specialDateId,
      });
      if (ranges.length)
        await tx.insert(menuSlots).values(
          ranges.map((r) => ({
            timetableId,
            departmentId,
            periodId,
            startsAt: `${r.startsAt}:00`,
            endsAt: `${r.endsAt}:00`,
          })),
        );
    } else {
      await seasonDay(tx, { departmentId, seasonId, weekday: 3, periodId, ranges });
    }
    return { cfg: { locationId: loc }, departmentId, periodId, seasonId, specialDateId, zoneId };
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
          expect.objectContaining({ reason: "range" }),
          expect.objectContaining({ reason: "range" }),
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
  it("refuses time writes while pending, allows metadata, and retains revision after cancellation", async () => {
    const v = await fixture([]);
    await withTransaction(suite.db, async (tx) => {
      await tx
        .insert(locationBusinessDaySettings)
        .values({ locationId: v.cfg.locationId, revision: 1 });
      await tx
        .insert(locationDayCutoverChanges)
        .values({ locationId: v.cfg.locationId, effectiveBusinessDay: E, dayCutover: "07:00:00" });
    });
    const guard = (kind: "time" | "metadata", revision: number, now = at) =>
      withTransaction(suite.db, (tx) =>
        assertBusinessDayScheduleWrite(tx, v.cfg, kind, now, revision),
      );
    await expect(guard("time", 1)).rejects.toMatchObject({
      code: "hours.clock_change_pending",
      params: { effectiveBusinessDay: E },
    });
    await expect(guard("metadata", 0)).resolves.toBeUndefined();
    await expect(guard("time", 0)).rejects.toMatchObject({
      code: "hours.clock_changed",
      params: {},
    });
    await expect(guard("time", 1, new Date("2026-11-04T06:00:00Z"))).resolves.toBeUndefined();
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
    expect(running.sendableMenuIds).toHaveLength(1);
    expect(running.endedMenuIds).toEqual([]);
    expect(running.keepOpen).toMatchObject({ periodId: v.periodId, running: true });
    expect((await read(end)).open).toBe(false);
  });
});

describe("pending guards every time writer", () => {
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
  it("guards normal and named menu ranges but accepts an equivalent week", async () => {
    const v = await fixture([range("09:00", "17:00")], { date: "2026-12-25" });
    await pending(v);
    await expect(
      withTransaction(suite.db, (tx) =>
        saveSpecialDateMenus(
          tx,
          v.cfg,
          v.specialDateId!,
          v.departmentId,
          [{ periodId: v.periodId, ...range("09:00", "18:00") }],
          at,
          1,
        ),
      ),
    ).rejects.toMatchObject({ code: "hours.clock_change_pending" });
    const week = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      slots: weekday === 3 ? [{ periodId: v.periodId, ...range("09:00", "17:00") }] : [],
    }));
    await expect(
      withTransaction(suite.db, (tx) => replaceMenuWeek(tx, v.cfg, v.departmentId, week, at, 1)),
    ).rejects.toMatchObject({ code: "hours.clock_change_pending" });
    const empty = week.map((day) => ({ ...day, slots: [] }));
    await expect(
      withTransaction(suite.db, (tx) => replaceMenuWeek(tx, v.cfg, v.departmentId, empty, at, 0)),
    ).resolves.toBeUndefined();
  });
  it("guards offsets but accepts names, colours and equivalent offsets", async () => {
    const v = await fixture([range("09:00", "17:00")]);
    await pending(v);
    await expect(
      withTransaction(suite.db, (tx) =>
        updateMenuPeriod(tx, v.cfg, v.periodId, { endOffsetMinutes: 1 }, 1, at),
      ),
    ).rejects.toMatchObject({ code: "hours.clock_change_pending" });
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
  });
  it("guards zone closed weeks and dates", async () => {
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
    ).rejects.toMatchObject({ code: "hours.clock_change_pending" });
    await expect(
      withTransaction(suite.db, (tx) =>
        saveZoneClosedDate(
          tx,
          v.cfg,
          v.specialDateId!,
          v.zoneId!,
          [range("12:00", "13:00")],
          1,
          at,
        ),
      ),
    ).rejects.toMatchObject({ code: "hours.clock_change_pending" });
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
  expect(await read("2026-11-03T12:00:00Z")).toMatchObject({
    businessDayClock: candidate("07:00"),
    clockRevision: 2,
    currentBusinessDay: "2026-11-03",
    pending: { effectiveBusinessDay: E, editable: false },
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
  it("checks a normal menu week against the retained 07:00 start", async () => {
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
  it("checks a normal zone week against the retained 07:00 start", async () => {
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
    const v = await fixture([], { date: "2026-12-25" });
    await activated(v);
    await expect(
      withTransaction(suite.db, (tx) =>
        saveSpecialDateMenus(
          tx,
          v.cfg,
          v.specialDateId!,
          v.departmentId,
          [{ periodId: v.periodId, ...range("07:00", "07:00") }],
          after,
          1,
        ),
      ),
    ).resolves.toBeUndefined();
  });
  it("accepts a one-off zone day under its own 07:00 start", async () => {
    const v = await fixture([], { zone: true, date: "2026-12-25" });
    await activated(v);
    await expect(
      withTransaction(suite.db, (tx) =>
        saveZoneClosedDate(
          tx,
          v.cfg,
          v.specialDateId!,
          v.zoneId!,
          [range("07:00", "07:00")],
          1,
          after,
        ),
      ),
    ).resolves.toBeUndefined();
  });
  it("checks annual menu ranges against every retained start", async () => {
    const v = await fixture([], { date: "2026-12-25", annual: true });
    await activated(v);
    await expect(
      withTransaction(suite.db, (tx) =>
        saveSpecialDateMenus(
          tx,
          v.cfg,
          v.specialDateId!,
          v.departmentId,
          [{ periodId: v.periodId, ...range("07:00", "07:00") }],
          after,
          1,
        ),
      ),
    ).rejects.toMatchObject({ code: "menu_timetable.invalid" });
  });
  it("checks annual zone ranges against every retained start", async () => {
    const v = await fixture([], { zone: true, date: "2026-12-25", annual: true });
    await activated(v);
    await expect(
      withTransaction(suite.db, (tx) =>
        saveZoneClosedDate(
          tx,
          v.cfg,
          v.specialDateId!,
          v.zoneId!,
          [range("07:00", "07:00")],
          1,
          after,
        ),
      ),
    ).rejects.toMatchObject({ code: "zone_closed_time.invalid" });
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
    const v = await fixture([], { date: "2026-12-25", offset: -1 });
    await activated(v);
    await expect(
      withTransaction(suite.db, (tx) =>
        saveSpecialDateMenus(
          tx,
          v.cfg,
          v.specialDateId!,
          v.departmentId,
          [{ periodId: v.periodId, ...range("07:00", "07:00") }],
          after,
          1,
        ),
      ),
    ).resolves.toBeUndefined();
  });
  it("accepts a skipped final boundary at the reporting boundary instant", async () => {
    const v = await fixture([], { date: "2026-03-28" });
    await withTransaction(suite.db, (tx) =>
      tx
        .update(locations)
        .set({ dayCutover: "02:30:00" })
        .where(eq(locations.id, v.cfg.locationId)),
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        saveSpecialDateMenus(
          tx,
          v.cfg,
          v.specialDateId!,
          v.departmentId,
          [{ periodId: v.periodId, ...range("09:00", "02:30") }],
          new Date("2026-03-20T12:00:00Z"),
          0,
        ),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("clock compatibility resolves neighboring named-day substitutions", () => {
  async function neighbor(
    ownHours: boolean,
    closeWholeVenue: boolean,
    ranges: { startsAt: string; endsAt: string }[],
    annual = false,
  ) {
    const v = await fixture([range("22:00", "04:30")], { offset: 180, date: E });
    await withTransaction(suite.db, async (tx) => {
      await seasonDay(tx, {
        departmentId: v.departmentId,
        seasonId: v.seasonId,
        weekday: 4,
        periodId: v.periodId,
        ranges: [range("07:15", "09:00")],
      });
      const id = randomUUID();
      await tx.insert(specialDates).values({
        id,
        locationId: v.cfg.locationId,
        date: annual ? "2025-11-06" : "2026-11-05",
        repeatOn: annual ? "11-06" : null,
        name: "Neighbor",
        ownHours,
        closeWholeVenue,
      });
      if (ownHours) {
        const timetableId = randomUUID();
        await tx
          .insert(menuDayTimetables)
          .values({ id: timetableId, departmentId: v.departmentId, specialDateId: id });
        if (ranges.length)
          await tx.insert(menuSlots).values(
            ranges.map((r) => ({
              timetableId,
              departmentId: v.departmentId,
              periodId: v.periodId,
              startsAt: `${r.startsAt}:00`,
              endsAt: `${r.endsAt}:00`,
            })),
          );
      }
    });
    return v;
  }
  it.each([
    [true, false],
    [false, true],
  ])("honors an empty override or closed neighbor (%s,%s)", async (ownHours, closed) => {
    await expect(check(await neighbor(ownHours, closed, []), "07:00")).resolves.toBeUndefined();
  });
  it("includes the next occurrence of an annual override beside a normal week", async () => {
    const v = await fixture([range("22:00", "04:30")], { offset: 180 });
    await withTransaction(suite.db, async (tx) => {
      const id = randomUUID(),
        timetableId = randomUUID();
      await tx.insert(specialDates).values({
        id,
        locationId: v.cfg.locationId,
        date: "2025-11-05",
        repeatOn: "11-05",
        name: "Annual neighbor",
        ownHours: true,
      });
      await tx
        .insert(menuDayTimetables)
        .values({ id: timetableId, departmentId: v.departmentId, specialDateId: id });
      await tx.insert(menuSlots).values({
        timetableId,
        departmentId: v.departmentId,
        periodId: v.periodId,
        startsAt: "07:15:00",
        endsAt: "09:00:00",
      });
    });
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
        expect(result.sendableMenuIds).toEqual([]);
        expect(result.endedMenuIds).toHaveLength(1);
      }
      const boundary = time === "07:00" ? "2026-11-04T06:00:00Z" : "2026-11-04T02:00:00Z";
      expect(await read(boundary)).toMatchObject({
        open: false,
        sendableMenuIds: [],
        orderableMenuIds: [],
      });
    },
  );
  it("uses yesterday's own 05:00 start for positive grace after the 07:00 boundary", async () => {
    const v = await writtenFixture([range("22:00", "04:30")], { offset: 180, weekday: 2 });
    await timeline(v, "07:00");
    const read = (instant: string) =>
      withTransaction(suite.db, (tx) =>
        resolveDepartmentService(tx, v.cfg, v.departmentId, new Date(instant)),
      );
    const grace = await read("2026-11-04T06:00:00Z");
    expect(grace).toMatchObject({ open: false, orderableMenuIds: [] });
    expect(grace.sendableMenuIds).toHaveLength(1);
    expect((await read("2026-11-04T06:30:00Z")).sendableMenuIds).toEqual([]);
  });
  it("retains yesterday's negative offset and the exact early sending cutoff", async () => {
    const v = await writtenFixture([range("22:00", "04:30")], { offset: -60, weekday: 2 });
    await timeline(v, "07:00");
    const read = (instant: string) =>
      withTransaction(suite.db, (tx) =>
        resolveDepartmentService(tx, v.cfg, v.departmentId, new Date(instant)),
      );
    expect((await read("2026-11-04T02:29:00Z")).sendableMenuIds).toHaveLength(1);
    expect(await read("2026-11-04T02:30:00Z")).toMatchObject({
      open: true,
      orderableMenuIds: [],
      sendableMenuIds: [],
    });
    expect((await read("2026-11-04T06:00:00Z")).sendableMenuIds).toEqual([]);
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
        specialDateName: "Named day",
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
  it("ignores a named day whose day before is another season's weekday", async () => {
    const v = await fixture([range("22:00", "04:30")], { offset: 180 });
    await twoSeasons(v);
    await withTransaction(suite.db, async (tx) => {
      const id = randomUUID(),
        timetableId = randomUUID();
      // 2026-11-04, the Wednesday before, is in Summer; the painted Wednesday is Winter's.
      await tx.insert(specialDates).values({
        id,
        locationId: v.cfg.locationId,
        date: "2026-11-05",
        name: "Summer neighbour",
        ownHours: true,
      });
      await tx
        .insert(menuDayTimetables)
        .values({ id: timetableId, departmentId: v.departmentId, specialDateId: id });
      await tx.insert(menuSlots).values({
        timetableId,
        departmentId: v.departmentId,
        periodId: v.periodId,
        startsAt: "07:15:00",
        endsAt: "09:00:00",
      });
    });
    await expect(check(v, "07:00")).resolves.toBeUndefined();
  });
  it("follows a named day with the next day's own season week", async () => {
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
  /** Raw rows, bypassing the special-day writer's checks. */
  async function specialDay(
    v: Awaited<ReturnType<typeof fixture>>,
    date: string,
    ranges: { periodId: string | null; startsAt: string; endsAt: string }[],
  ) {
    return withTransaction(suite.db, async (tx) => {
      const specialDayId = randomUUID(),
        dateId = randomUUID(),
        dayId = randomUUID();
      await tx
        .insert(specialDays)
        .values({ id: specialDayId, locationId: v.cfg.locationId, name: "Fiesta" });
      await tx
        .insert(specialDayDates)
        .values({ id: dateId, specialDayId, locationId: v.cfg.locationId, date });
      await tx
        .insert(departmentDays)
        .values({ id: dayId, departmentId: v.departmentId, specialDayDateId: dateId });
      if (ranges.length > 0)
        await tx.insert(departmentDayRanges).values(
          ranges.map((r) => ({
            dayId,
            departmentId: v.departmentId,
            periodId: r.periodId,
            startsAt: `${r.startsAt}:00`,
            endsAt: `${r.endsAt}:00`,
          })),
        );
      return specialDayId;
    });
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
});

/** Four seasons, three departments and `count` yearly named days and yearly special days, with
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
      const namedId = fixed(4, i);
      await tx.insert(specialDates).values({
        id: namedId,
        locationId: loc,
        date: date((i % 12) + 1, 2 + (i % 14)),
        name: `Named ${i}`,
        repeatOn: date((i % 12) + 1, 2 + (i % 14)).slice(5),
        ownHours: true,
        closeWholeVenue: i % 5 === 4,
      });
      const timetableId = randomUUID();
      await tx
        .insert(menuDayTimetables)
        .values({ id: timetableId, departmentId: departmentsMade[0]!.id, specialDateId: namedId });
      await tx.insert(menuSlots).values({
        timetableId,
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

it("lists the same conflicts for many yearly named days and special days", async () => {
  const cfg = await busyCalendar(50);
  const result = await withTransaction(suite.db, (tx) =>
    businessDayClockConflicts(tx, cfg, before, candidate("04:00"), E),
  );
  const lines = result.conflicts.map((c) =>
    [
      c.departmentName,
      c.specialDayName ?? c.specialDateName ?? c.seasonName,
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
