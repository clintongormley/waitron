import { replaceZoneClosedWeek, saveZoneClosedDate } from "./zone-closed-times.js";
import { saveSpecialDate, duplicateSpecialDate } from "./hours.js";
import {
  replaceMenuWeek,
  saveSpecialDateMenus,
  updateMenuPeriod,
  readOpeningHoursModel,
  resolveDepartmentService,
} from "./menu-timetable.js";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  catalogues,
  floorZones,
  locations,
  locationBusinessDaySettings,
  locationDayCutoverChanges,
  withTransaction,
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
      if (ranges.length)
        await tx.insert(zoneClosedTimes).values(
          ranges.map((r) => ({
            zoneId: zoneId!,
            weekday: specialDateId ? null : 3,
            specialDateId,
            startsAt: `${r.startsAt}:00`,
            endsAt: `${r.endsAt}:00`,
          })),
        );
    } else {
      const timetableId = randomUUID();
      await tx.insert(menuDayTimetables).values({
        id: timetableId,
        departmentId,
        weekday: specialDateId ? null : 3,
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
    }
    return { cfg: { locationId: loc }, departmentId, periodId, specialDateId, zoneId };
  });
}
const range = (startsAt: string, endsAt: string) => ({ startsAt, endsAt });
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
    const v = await fixture([range("02:30", "02:30")]);
    await withTransaction(suite.db, (tx) =>
      tx
        .update(locations)
        .set({ dayCutover: "02:30:00" })
        .where(eq(locations.id, v.cfg.locationId)),
    );
    await withTransaction(suite.db, (tx) =>
      tx
        .update(menuDayTimetables)
        .set({ weekday: 6 })
        .where(eq(menuDayTimetables.departmentId, v.departmentId)),
    );
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
  it.each([
    { date: "2026-12-26" },
    { repeats: true },
    { ownHours: false },
    { ownHours: false, closeWholeVenue: true },
  ])("guards a calendar time change %j", async (change) => {
    const v = await fixture([range("09:00", "17:00")], { date: "2026-12-25" });
    await pending(v);
    await expect(
      withTransaction(suite.db, (tx) =>
        saveSpecialDate(
          tx,
          v.cfg,
          v.specialDateId!,
          {
            date: "2026-12-25",
            name: "Named day",
            ownHours: true,
            closeWholeVenue: false,
            ...change,
          },
          at,
          [],
          1,
        ),
      ),
    ).rejects.toMatchObject({ code: "hours.clock_change_pending" });
    await expect(
      withTransaction(suite.db, (tx) =>
        saveSpecialDate(
          tx,
          v.cfg,
          v.specialDateId!,
          { date: "2026-12-25", name: "Renamed", ownHours: true, closeWholeVenue: false },
          at,
          [],
          0,
        ),
      ),
    ).resolves.toMatchObject({ name: "Renamed" });
  });
  it("guards calendar copies and permits a fresh revision after cancellation", async () => {
    const v = await fixture([range("09:00", "17:00")], { date: "2026-12-25" });
    await pending(v);
    const copy = (revision: number) =>
      withTransaction(suite.db, (tx) =>
        duplicateSpecialDate(tx, v.cfg, v.specialDateId!, ["2026-12-26"], at, [], revision),
      );
    await expect(copy(1)).rejects.toMatchObject({ code: "hours.clock_change_pending" });
    await withTransaction(suite.db, (tx) =>
      tx
        .delete(locationDayCutoverChanges)
        .where(eq(locationDayCutoverChanges.locationId, v.cfg.locationId)),
    );
    await expect(copy(0)).rejects.toMatchObject({ code: "hours.clock_changed" });
    await expect(copy(1)).resolves.toMatchObject([{ date: "2026-12-26" }]);
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
