import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  kitchenStations,
  locations,
  tenants,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { readHolidayFacts } from "./holidays.js";
import { replaceWeekHours, saveSpecialDate } from "./hours.js";
import { weekdayOf } from "./hours-rules.js";
import { WEEK_DISPLAY_ORDER, type DateCell, type WeekCell, type WeekDay } from "./hours-types.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import type { VenueScope } from "./operations.js";
import { routingModel } from "./routing-store.js";
import * as stationTimes from "./station-times.js";
import { hoursWeekCells } from "./schema/hours.js";
import { stationDayStates } from "./schema/station-times.js";
import { setStationFallback, setStationToday, venueMoment } from "./station-times.js";
import { clockChangeAfter, minutesAfter } from "./testing/clock-change.js";
import { seedStationWeek } from "./testing/station-week.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function fixture(tx: Transaction) {
  const [location] = await tx
    .insert(locations)
    .values({
      name: "Venue",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
    })
    .returning();
  const cfg = { locationId: locationId(location!.id) };
  const [other] = await tx
    .insert(locations)
    .values({ name: "Other", invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
    .returning();
  const stations = await tx
    .insert(kitchenStations)
    .values([
      { ...cfg, name: "Upstairs bar" },
      { ...cfg, name: "Downstairs bar" },
      { ...cfg, name: "Kitchen", isDefault: true },
      { ...cfg, name: "Retired", active: false },
      { locationId: locationId(other!.id), name: "Other station" },
    ])
    .returning();
  return {
    cfg,
    upstairs: stations[0]!.id,
    downstairs: stations[1]!.id,
    kitchen: stations[2]!.id,
    retired: stations[3]!.id,
    otherStation: stations[4]!.id,
  };
}

describe("station times", () => {
  it("shows an empty routing model before the venue adds its first prep station", async () => {
    await db.transaction(async (tx) => {
      const [venue] = await tx
        .insert(locations)
        .values({
          name: "New venue",
          invoiceLocales: ["en-GB"],
          operationDescription: "Hospitality",
          timeZone: "Europe/Madrid",
          dayCutover: "06:00:00",
        })
        .returning();
      const model = await routingModel(
        tx,
        { locationId: locationId(venue!.id) },
        new Date("2026-10-02T18:00:00Z"),
      );
      expect(model.stations).toEqual([]);
      expect(model.stationTimes).toEqual([]);
      expect(model.defaultStationId).toBeNull();
    });
  });

  it("replaces a station's whole week and refuses another venue's station", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await seedStationWeek(tx, f.cfg, f.upstairs, [
        { weekday: 5, opensAt: "19:00", closesAt: "21:00" },
      ]);
      await seedStationWeek(tx, f.cfg, f.upstairs, [
        { weekday: 6, opensAt: "19:00", closesAt: "21:00" },
      ]);
      const row = (
        await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))
      ).stationTimes.find((s) => s.stationId === f.upstairs);
      expect(row?.hours).toEqual([{ weekday: 6, opensAt: "19:00", closesAt: "21:00" }]);
      expect(row?.weekSet).toBe(true);
      // Friday 20:00 in Madrid: only the replaced Saturday is open.
      expect(row?.status).toEqual({ open: false, why: "out_of_hours" });
      await expect(seedStationWeek(tx, f.cfg, f.otherStation, [])).rejects.toMatchObject({
        code: "hours.invalid",
        params: { field: "subject" },
      });
    });
  });

  it("clears the weekly schedule when its last interval is removed", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await seedStationWeek(tx, f.cfg, f.upstairs, [
        { weekday: 5, opensAt: "19:00", closesAt: "21:00" },
      ]);
      await seedStationWeek(tx, f.cfg, f.upstairs, []);
      const row = (
        await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))
      ).stationTimes.find((station) => station.stationId === f.upstairs);
      expect(row?.hours).toEqual([]);
      expect(row?.weekSet).toBe(false);
      expect(row?.status).toEqual({ open: true, why: "no_hours" });
      expect(
        await tx.select().from(hoursWeekCells).where(eq(hoursWeekCells.stationId, f.upstairs)),
      ).toEqual([]);
    });
  });

  it("refuses a switched-off fallback and a fallback loop", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await expect(setStationFallback(tx, f.cfg, f.upstairs, f.retired)).rejects.toMatchObject({
        code: "route.station_inactive",
      });
      await expect(setStationFallback(tx, f.cfg, f.upstairs, f.upstairs)).rejects.toMatchObject({
        code: "station.fallback_loop",
      });
      await setStationFallback(tx, f.cfg, f.upstairs, f.downstairs);
      await expect(setStationFallback(tx, f.cfg, f.downstairs, f.upstairs)).rejects.toMatchObject({
        code: "station.fallback_loop",
      });
      await setStationFallback(tx, f.cfg, f.retired, f.downstairs);
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).stationTimes.find(
          (s) => s.stationId === f.retired,
        )?.fallbackStationId,
      ).toBe(f.downstairs);
    });
  });

  it("keeps a by-hand close until cutover and then follows the schedule", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await setStationToday(tx, f.cfg, f.upstairs, "closed", new Date("2026-10-02T21:00:00Z"));
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-03T03:59:00Z"))).stationTimes.find(
          (s) => s.stationId === f.upstairs,
        )?.status,
      ).toEqual({ open: false, why: "closed_by_hand" });
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-03T04:00:00Z"))).stationTimes.find(
          (s) => s.stationId === f.upstairs,
        )?.status,
      ).toEqual({ open: true, why: "no_hours" });
    });
  });

  it("clears earlier by-hand days and can return to the schedule", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await setStationToday(tx, f.cfg, f.upstairs, "closed", new Date("2026-10-02T21:00:00Z"));
      await setStationToday(tx, f.cfg, f.upstairs, "open", new Date("2026-10-03T10:00:00Z"));
      expect(await tx.select().from(stationDayStates)).toHaveLength(1);
      await setStationToday(tx, f.cfg, f.upstairs, null, new Date("2026-10-03T10:00:00Z"));
      expect(await tx.select().from(stationDayStates)).toHaveLength(0);
    });
  });

  it("refuses a by-hand change when the venue clock is unreadable", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await tx
        .update(locations)
        .set({ timeZone: "Mars/Base" })
        .where(eq(locations.id, f.cfg.locationId));
      await expect(
        setStationToday(tx, f.cfg, f.upstairs, "closed", new Date("2026-10-02T18:00:00Z")),
      ).rejects.toMatchObject({ code: "time_zone.unreadable" });
      expect(await venueMoment(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).toBeNull();
      expect((await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).clockReadable).toBe(
        false,
      );
    });
  });

  it("shows the closed destination and the end of today's change", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await setStationFallback(tx, f.cfg, f.upstairs, f.downstairs);
      const model = await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"));
      expect(model.stationTimes.find((s) => s.stationId === f.upstairs)?.closedSendsTo).toBe(
        f.downstairs,
      );
      expect(
        model.stationTimes.find((s) => s.stationId === f.downstairs)?.closedSendsTo,
      ).toBeNull();
      expect(model.todayEnds).toEqual({ timeOfDay: "06:00", tomorrow: true });
      expect((await routingModel(tx, f.cfg, new Date("2026-10-02T23:30:00Z"))).todayEnds).toEqual({
        timeOfDay: "06:00",
        tomorrow: false,
      });
      expect((await routingModel(tx, f.cfg, new Date("2026-10-03T04:00:00Z"))).todayEnds).toEqual({
        timeOfDay: "06:00",
        tomorrow: true,
      });
    });
  });
});

describe("next scheduled station transition", () => {
  it.each([
    [
      "before opening",
      "2026-10-02T09:00:00Z",
      [{ weekday: 5, opensAt: "12:00", closesAt: "01:00" }],
      { weekday: 5, timeOfDay: "12:00", daysAhead: 0 },
    ],
    [
      "at opening",
      "2026-10-02T10:00:00Z",
      [{ weekday: 5, opensAt: "12:00", closesAt: "01:00" }],
      { weekday: 6, timeOfDay: "01:00", daysAhead: 1 },
    ],
    [
      "after midnight",
      "2026-10-02T22:30:00Z",
      [{ weekday: 5, opensAt: "12:00", closesAt: "01:00" }],
      { weekday: 6, timeOfDay: "01:00", daysAhead: 0 },
    ],
    [
      "at closing",
      "2026-10-02T23:00:00Z",
      [{ weekday: 5, opensAt: "12:00", closesAt: "01:00" }],
      { weekday: 5, timeOfDay: "12:00", daysAhead: 6 },
    ],
    [
      "overlapping intervals",
      "2026-10-02T11:00:00Z",
      [
        { weekday: 5, opensAt: "12:00", closesAt: "16:00" },
        { weekday: 5, opensAt: "15:00", closesAt: "19:00" },
      ],
      { weekday: 5, timeOfDay: "19:00", daysAhead: 0 },
    ],
    [
      "adjacent intervals",
      "2026-10-02T11:00:00Z",
      [
        { weekday: 5, opensAt: "12:00", closesAt: "16:00" },
        { weekday: 5, opensAt: "16:00", closesAt: "19:00" },
      ],
      { weekday: 5, timeOfDay: "19:00", daysAhead: 0 },
    ],
    [
      "week wrap",
      "2026-10-03T21:00:00Z",
      [{ weekday: 6, opensAt: "22:00", closesAt: "02:00" }],
      { weekday: 0, timeOfDay: "02:00", daysAhead: 1 },
    ],
    [
      "next weekday",
      "2026-10-02T09:00:00Z",
      [{ weekday: 1, opensAt: "12:00", closesAt: "16:00" }],
      { weekday: 1, timeOfDay: "12:00", daysAhead: 3 },
    ],
    [
      "continuous week",
      "2026-10-02T09:00:00Z",
      Array.from({ length: 7 }, (_, weekday) => [
        { weekday, opensAt: "00:00", closesAt: "12:00" },
        { weekday, opensAt: "12:00", closesAt: "00:00" },
      ]).flat(),
      null,
    ],
  ])("reports the actual state change %s", async (_name, instant, hours, expected) => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await seedStationWeek(tx, f.cfg, f.upstairs, hours);
      const model = await routingModel(tx, f.cfg, new Date(instant));
      expect(
        model.stationTimes.find((row) => row.stationId === f.upstairs)?.nextTransition,
      ).toEqual(expected);
    });
  });

  it("omits schedule transitions for default, disabled, unscheduled and by-hand stations", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      const now = new Date("2026-10-02T11:00:00Z");
      // The default keeps a week saved before it became the default.
      await tx
        .update(kitchenStations)
        .set({ isDefault: false })
        .where(eq(kitchenStations.id, f.kitchen));
      for (const id of [f.upstairs, f.kitchen, f.retired])
        await seedStationWeek(tx, f.cfg, id, [{ weekday: 5, opensAt: "12:00", closesAt: "16:00" }]);
      await tx
        .update(kitchenStations)
        .set({ isDefault: true })
        .where(eq(kitchenStations.id, f.kitchen));
      for (const state of ["closed", "open"] as const) {
        await setStationToday(tx, f.cfg, f.upstairs, state, now);
        const model = await routingModel(tx, f.cfg, now);
        expect(model.stationTimes.map((row) => row.nextTransition)).toEqual([
          null,
          null,
          null,
          null,
        ]);
      }
      await setStationToday(tx, f.cfg, f.upstairs, null, now);
      await tx
        .update(locations)
        .set({ timeZone: "Mars/Base" })
        .where(eq(locations.id, f.cfg.locationId));
      const unreadable = await routingModel(tx, f.cfg, now);
      expect(unreadable.stationTimes.map((row) => row.nextTransition)).toEqual([
        null,
        null,
        null,
        null,
      ]);
    });
  });
});

/** When the hours below are saved: before every date they are read at. */
const SAVED_AT = new Date("2026-10-01T10:00:00Z");
const hourPeriod = (opensAt: string, closesAt: string) => ({ id: randomUUID(), opensAt, closesAt });
const closedCell: WeekCell = { mode: "closed", periods: [] };
/** A configured week: Closed every day except the weekdays `cells` names. */
const configuredWeek = (cells: Partial<Record<number, WeekCell>> = {}): WeekDay[] =>
  WEEK_DISPLAY_ORDER.map((weekday) => ({ weekday, cell: cells[weekday] ?? closedCell }));
const periodsCell = (...periods: [string, string][]): WeekCell => ({
  mode: "periods",
  periods: periods.map(([opensAt, closesAt]) => hourPeriod(opensAt, closesAt)),
});
const station = (id: string) => ({ kind: "station" as const, id });

async function saveWeek(tx: Transaction, cfg: VenueScope, id: string, days: WeekDay[]) {
  await replaceWeekHours(tx, cfg, station(id), days, SAVED_AT);
}

async function saveDate(
  tx: Transaction,
  cfg: VenueScope,
  date: string,
  cells: [string, DateCell][],
  closeWholeVenue = false,
) {
  return saveSpecialDate(
    tx,
    cfg,
    null,
    {
      date,
      name: `Special ${date}`,
      closeWholeVenue,
      cells: cells.map(([id, cell]) => ({ subject: station(id), cell })),
    },
    SAVED_AT,
  );
}

async function statusAt(tx: Transaction, cfg: VenueScope, id: string, instant: Date | string) {
  return (await routingModel(tx, cfg, new Date(instant))).stationTimes.find(
    (row) => row.stationId === id,
  )?.status;
}

const inHours = { open: true, why: "in_hours" };
const outOfHours = { open: false, why: "out_of_hours" };
const closedDate: DateCell = { mode: "closed", periods: [] };

describe("station status by calendar date", () => {
  // Madrid is two hours ahead of UTC until 25 October 2026, one hour after it.
  it("keeps Monday's overnight hours on Tuesday through Tuesday's Closed, but not once Monday is Closed", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await saveWeek(tx, f.cfg, f.upstairs, configuredWeek({ 1: periodsCell(["22:00", "02:00"]) }));
      const tuesdayHalfPastMidnight = "2026-10-05T22:30:00Z";
      expect(await statusAt(tx, f.cfg, f.upstairs, tuesdayHalfPastMidnight)).toEqual(inHours);
      await saveDate(tx, f.cfg, "2026-10-06", [[f.upstairs, closedDate]]);
      expect(await statusAt(tx, f.cfg, f.upstairs, tuesdayHalfPastMidnight)).toEqual(inHours);
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-06T00:00:00Z")).toEqual(outOfHours);
      await saveDate(tx, f.cfg, "2026-10-05", [[f.upstairs, closedDate]]);
      expect(await statusAt(tx, f.cfg, f.upstairs, tuesdayHalfPastMidnight)).toEqual(outOfHours);
    });
  });

  it("reads each special date's own hours across a month end, a year end and Sunday into Monday", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      const late = (opensAt: string, closesAt: string): DateCell => ({
        mode: "periods",
        periods: [hourPeriod(opensAt, closesAt)],
      });
      await saveDate(tx, f.cfg, "2026-12-31", [[f.upstairs, late("22:00", "03:00")]]);
      await saveDate(tx, f.cfg, "2027-01-01", [[f.upstairs, closedDate]]);
      await saveDate(tx, f.cfg, "2026-10-31", [[f.downstairs, late("23:00", "01:00")]]);
      await saveWeek(tx, f.cfg, f.retired, configuredWeek({ 1: periodsCell(["12:00", "14:00"]) }));
      await tx
        .update(kitchenStations)
        .set({ active: true })
        .where(eq(kitchenStations.id, f.retired));
      await saveDate(tx, f.cfg, "2026-10-11", [[f.retired, late("23:00", "02:00")]]);

      expect(await statusAt(tx, f.cfg, f.upstairs, "2027-01-01T01:30:00Z")).toEqual(inHours);
      expect(await statusAt(tx, f.cfg, f.upstairs, "2027-01-01T02:00:00Z")).toEqual(outOfHours);
      expect(await statusAt(tx, f.cfg, f.downstairs, "2026-10-31T23:30:00Z")).toEqual(inHours);
      expect(await statusAt(tx, f.cfg, f.downstairs, "2026-11-01T00:00:00Z")).toEqual({
        open: true,
        why: "no_hours",
      });
      // Monday 12 October at 01:00 and 02:00 in Madrid.
      expect(await statusAt(tx, f.cfg, f.retired, "2026-10-11T23:00:00Z")).toEqual(inHours);
      expect(await statusAt(tx, f.cfg, f.retired, "2026-10-12T00:00:00Z")).toEqual(outOfHours);
    });
  });

  it("opens a station all day from midnight until the next midnight", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await saveWeek(
        tx,
        f.cfg,
        f.upstairs,
        configuredWeek({ 2: { mode: "all_day", periods: [] } }),
      );
      await saveDate(tx, f.cfg, "2026-10-08", [[f.upstairs, { mode: "all_day", periods: [] }]]);
      // Tuesday 6 October from 00:00 to 23:59 in Madrid, then Wednesday's Closed.
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-05T22:00:00Z")).toEqual(inHours);
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-06T21:59:00Z")).toEqual(inHours);
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-06T22:00:00Z")).toEqual(outOfHours);
      // Thursday 8 October is a special date open all day.
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-08T12:00:00Z")).toEqual(inHours);
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-08T22:00:00Z")).toEqual(outOfHours);
    });
  });

  it("reports the change at midnight between a date with hours and a date with none", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      const timesAt = async (instant: string) => {
        const row = (await routingModel(tx, f.cfg, new Date(instant))).stationTimes.find(
          (times) => times.stationId === f.upstairs,
        );
        return { status: row?.status, next: row?.nextTransition };
      };
      const saturdayMidnight = { weekday: 6, timeOfDay: "00:00", daysAhead: 1 };
      // Friday 9 October is closed whole; the station has no weekly hours. 20:00 in Madrid.
      await saveDate(tx, f.cfg, "2026-10-09", [], true);
      expect(await timesAt("2026-10-09T18:00:00Z")).toEqual({
        status: outOfHours,
        next: saturdayMidnight,
      });
      // Thursday 8 October has no hours and Friday is Closed: open until Friday's midnight.
      expect(await timesAt("2026-10-08T18:00:00Z")).toEqual({
        status: { open: true, why: "no_hours" },
        next: { weekday: 5, timeOfDay: "00:00", daysAhead: 1 },
      });
    });
  });

  it("reports the midnight after a special date whose hours end before it", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await saveDate(tx, f.cfg, "2026-10-09", [
        [f.upstairs, { mode: "periods", periods: [hourPeriod("12:00", "16:00")] }],
      ]);
      const row = (
        await routingModel(tx, f.cfg, new Date("2026-10-09T15:00:00Z"))
      ).stationTimes.find((times) => times.stationId === f.upstairs);
      expect(row?.status).toEqual(outOfHours);
      expect(row?.nextTransition).toEqual({ weekday: 6, timeOfDay: "00:00", daysAhead: 1 });
    });
  });

  it("says which stations a special date from today onwards closes for some or all of its day", async () => {
    await db.transaction(async (tx) => {
      const tuesdayNoon = new Date("2026-10-06T10:00:00Z");
      const restricts = async (cfg: VenueScope, id: string) =>
        (await routingModel(tx, cfg, tuesdayNoon)).stationTimes.find((row) => row.stationId === id)
          ?.specialDateRestricts;
      const f = await fixture(tx);
      expect(await restricts(f.cfg, f.upstairs)).toBe(false);
      // Christmas Eve is past the seven days the status reads.
      await saveDate(tx, f.cfg, "2026-12-24", [
        [f.upstairs, { mode: "periods", periods: [hourPeriod("12:00", "16:00")] }],
      ]);
      await saveDate(tx, f.cfg, "2026-10-05", [[f.downstairs, closedDate]]);
      await saveDate(tx, f.cfg, "2026-10-20", [[f.downstairs, { mode: "all_day", periods: [] }]]);
      expect(await restricts(f.cfg, f.upstairs)).toBe(true);
      expect(await restricts(f.cfg, f.downstairs)).toBe(false);
      await saveDate(tx, f.cfg, "2026-10-06", [[f.downstairs, closedDate]]);
      expect(await restricts(f.cfg, f.downstairs)).toBe(true);

      const g = await fixture(tx);
      await saveDate(tx, g.cfg, "2027-01-06", [], true);
      expect(await restricts(g.cfg, g.upstairs)).toBe(true);
      expect(await restricts(g.cfg, g.downstairs)).toBe(true);
      expect(await restricts(f.cfg, f.retired)).toBe(false);

      // With no readable clock there is no today, so a past date counts too.
      const h = await fixture(tx);
      await saveDate(tx, h.cfg, "2026-10-02", [[h.upstairs, closedDate]]);
      expect(await restricts(h.cfg, h.upstairs)).toBe(false);
      await tx
        .update(locations)
        .set({ timeZone: "Mars/Base" })
        .where(eq(locations.id, h.cfg.locationId));
      expect(await restricts(h.cfg, h.upstairs)).toBe(true);
    });
  });

  it("tells a station with no hours set from one Closed every day", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await saveWeek(tx, f.cfg, f.upstairs, configuredWeek());
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-06T10:00:00Z")).toEqual(outOfHours);
      expect(await statusAt(tx, f.cfg, f.downstairs, "2026-10-06T10:00:00Z")).toEqual({
        open: true,
        why: "no_hours",
      });
    });
  });

  it("keeps a by-hand change until the cutover, and Back to the schedule restores the special date", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await saveDate(tx, f.cfg, "2026-10-06", [
        [f.upstairs, { mode: "periods", periods: [hourPeriod("12:00", "23:00")] }],
        [f.downstairs, closedDate],
      ]);
      const afternoon = new Date("2026-10-06T13:00:00Z");
      expect(await statusAt(tx, f.cfg, f.upstairs, afternoon)).toEqual(inHours);
      await setStationToday(tx, f.cfg, f.upstairs, "closed", afternoon);
      expect(await statusAt(tx, f.cfg, f.upstairs, afternoon)).toEqual({
        open: false,
        why: "closed_by_hand",
      });
      // Wednesday 05:59 is still Tuesday's business day; 06:00 is the cutover.
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-07T03:59:00Z")).toEqual({
        open: false,
        why: "closed_by_hand",
      });
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-07T04:00:00Z")).toEqual({
        open: true,
        why: "no_hours",
      });

      await setStationToday(tx, f.cfg, f.downstairs, "open", afternoon);
      expect(await statusAt(tx, f.cfg, f.downstairs, afternoon)).toEqual({
        open: true,
        why: "opened_by_hand",
      });
      await setStationToday(tx, f.cfg, f.downstairs, null, afternoon);
      expect(await statusAt(tx, f.cfg, f.downstairs, afternoon)).toEqual(outOfHours);
    });
  });

  it("keeps the default station open through a closed day, and an inactive default unavailable", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await saveWeek(tx, f.cfg, f.downstairs, configuredWeek());
      await saveDate(tx, f.cfg, "2026-10-06", [], true);
      await tx
        .update(kitchenStations)
        .set({ isDefault: false })
        .where(eq(kitchenStations.id, f.kitchen));
      await tx
        .update(kitchenStations)
        .set({ isDefault: true })
        .where(eq(kitchenStations.id, f.downstairs));
      expect(await statusAt(tx, f.cfg, f.downstairs, "2026-10-06T10:00:00Z")).toEqual({
        open: true,
        why: "default",
      });
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-06T10:00:00Z")).toEqual(outOfHours);
      await tx
        .update(kitchenStations)
        .set({ active: false })
        .where(eq(kitchenStations.id, f.downstairs));
      expect(await statusAt(tx, f.cfg, f.downstairs, "2026-10-06T10:00:00Z")).toEqual({
        open: false,
        why: "switched_off",
      });
    });
  });

  it("keeps the default station open on a date that still holds the Closed cell it was given before it became the default", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await saveWeek(
        tx,
        f.cfg,
        f.downstairs,
        configuredWeek({ 2: { mode: "all_day", periods: [] } }),
      );
      await saveDate(tx, f.cfg, "2026-10-06", [[f.downstairs, closedDate]]);
      expect(await statusAt(tx, f.cfg, f.downstairs, "2026-10-06T10:00:00Z")).toEqual(outOfHours);
      expect(await statusAt(tx, f.cfg, f.downstairs, "2026-10-13T10:00:00Z")).toEqual(inHours);
      await tx
        .update(kitchenStations)
        .set({ isDefault: false })
        .where(eq(kitchenStations.id, f.kitchen));
      await tx
        .update(kitchenStations)
        .set({ isDefault: true })
        .where(eq(kitchenStations.id, f.downstairs));
      expect(await statusAt(tx, f.cfg, f.downstairs, "2026-10-06T10:00:00Z")).toEqual({
        open: true,
        why: "default",
      });
    });
  });

  it("applies no hours at all while the venue's clock cannot be read", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await saveDate(tx, f.cfg, "2026-10-06", [], true);
      await tx
        .update(locations)
        .set({ timeZone: "Mars/Base" })
        .where(eq(locations.id, f.cfg.locationId));
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-06T10:00:00Z")).toEqual({
        open: true,
        why: "time_not_applied",
      });
    });
  });

  it.each(["00:00:00", "06:00:00"])(
    "picks the calendar date, not the business day, with a %s cutover",
    async (dayCutover) => {
      await db.transaction(async (tx) => {
        const f = await fixture(tx);
        await tx.update(locations).set({ dayCutover }).where(eq(locations.id, f.cfg.locationId));
        await saveWeek(
          tx,
          f.cfg,
          f.upstairs,
          configuredWeek({ 1: periodsCell(["22:00", "02:00"]) }),
        );
        await saveWeek(
          tx,
          f.cfg,
          f.downstairs,
          configuredWeek({ 2: periodsCell(["00:00", "01:00"]) }),
        );
        const tuesdayHalfPastMidnight = "2026-10-05T22:30:00Z";
        expect(await statusAt(tx, f.cfg, f.upstairs, tuesdayHalfPastMidnight)).toEqual(inHours);
        expect(await statusAt(tx, f.cfg, f.downstairs, tuesdayHalfPastMidnight)).toEqual(inHours);
        await saveDate(tx, f.cfg, "2026-10-05", [[f.upstairs, closedDate]]);
        expect(await statusAt(tx, f.cfg, f.upstairs, tuesdayHalfPastMidnight)).toEqual(outOfHours);
      });
    },
  );

  it("reports the next change from a special date's hours", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await saveWeek(tx, f.cfg, f.upstairs, configuredWeek({ 5: periodsCell(["12:00", "01:00"]) }));
      await saveDate(tx, f.cfg, "2026-10-02", [
        [f.upstairs, { mode: "periods", periods: [hourPeriod("14:00", "16:00")] }],
      ]);
      const next = async (instant: string) =>
        (await routingModel(tx, f.cfg, new Date(instant))).stationTimes.find(
          (row) => row.stationId === f.upstairs,
        )?.nextTransition;
      expect(await next("2026-10-02T09:00:00Z")).toEqual({
        weekday: 5,
        timeOfDay: "14:00",
        daysAhead: 0,
      });
      // Saturday 01:00: the next Friday's opening is six days ahead, until that Friday is Closed.
      expect(await next("2026-10-02T23:00:00Z")).toEqual({
        weekday: 5,
        timeOfDay: "12:00",
        daysAhead: 6,
      });
      await saveDate(tx, f.cfg, "2026-10-09", [[f.upstairs, closedDate]]);
      expect(await next("2026-10-02T23:00:00Z")).toBeNull();
    });
  });
});

describe("next change at a midnight the clocks move", () => {
  // Santiago changes its clocks at midnight; the changes are read from the runtime's zone data.
  const zone = "America/Santiago";
  const forward = clockChangeAfter(zone, "2027-08-01T00:00:00Z", "forward");
  const backward = clockChangeAfter(zone, "2027-03-01T00:00:00Z", "backward");
  const minute = 60_000;
  const previousDate = (date: string) =>
    new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

  async function closedStationNextChange(closedDate: string, at: Date) {
    let result: { status: unknown; next: unknown } | undefined;
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await tx.update(locations).set({ timeZone: zone }).where(eq(locations.id, f.cfg.locationId));
      await saveDate(tx, f.cfg, closedDate, [], true);
      const row = (await routingModel(tx, f.cfg, at)).stationTimes.find(
        (times) => times.stationId === f.upstairs,
      );
      result = { status: row?.status, next: row?.nextTransition };
    });
    return result!;
  }

  it("reports the first minute that exists when the clocks skip midnight", async () => {
    // Midnight is skipped: the clock goes from 23:59 straight to 01:00 on the next date.
    expect([forward.before, forward.after]).toEqual(["23:59", "01:00"]);
    const closedDate = previousDate(forward.date);
    expect(
      await closedStationNextChange(closedDate, new Date(forward.instant.getTime() - 120 * minute)),
    ).toEqual({
      status: outOfHours,
      next: { weekday: weekdayOf(forward.date), timeOfDay: "01:00", daysAhead: 1 },
    });
  });

  it("reports the one midnight that follows the hour the clocks repeat", async () => {
    // At midnight the clock goes back to 23:00 on the same date, so 23:00 to 23:59 happens twice
    // and the next date's midnight comes once, an hour later than it would have.
    expect([backward.before, backward.after]).toEqual(["23:59", "23:00"]);
    const nextDate = new Date(Date.parse(`${backward.date}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    // 23:30 on the first pass through the repeated hour.
    const at = new Date(backward.instant.getTime() - 30 * minute);
    expect(await closedStationNextChange(backward.date, at)).toEqual({
      status: outOfHours,
      next: { weekday: weekdayOf(nextDate), timeOfDay: "00:00", daysAhead: 1 },
    });
    // And the second pass through 23:30 gives the same answer.
    expect(
      await closedStationNextChange(
        backward.date,
        new Date(backward.instant.getTime() + 30 * minute),
      ),
    ).toEqual({
      status: outOfHours,
      next: { weekday: weekdayOf(nextDate), timeOfDay: "00:00", daysAhead: 1 },
    });
  });
});

describe("station status across a clock change", () => {
  const zone = "Europe/Madrid";
  const forward = clockChangeAfter(zone, "2027-01-01T00:00:00Z", "forward");
  const backward = clockChangeAfter(zone, "2027-07-01T00:00:00Z", "backward");
  const minute = 60_000;

  it("reports a closing the clock skips at the first minute that exists", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await saveWeek(
        tx,
        f.cfg,
        f.upstairs,
        configuredWeek({
          [weekdayOf(forward.date)]: periodsCell([
            minutesAfter(forward.before, -59),
            minutesAfter(forward.before, 31),
          ]),
        }),
      );
      const before = new Date(forward.instant.getTime() - 30 * minute);
      expect(await statusAt(tx, f.cfg, f.upstairs, before)).toEqual(inHours);
      expect(
        (await routingModel(tx, f.cfg, before)).stationTimes.find(
          (row) => row.stationId === f.upstairs,
        )?.nextTransition,
      ).toEqual({ weekday: weekdayOf(forward.date), timeOfDay: forward.after, daysAhead: 0 });
      expect(await statusAt(tx, f.cfg, f.upstairs, forward.instant)).toEqual(outOfHours);
    });
  });

  it("opens a period that starts inside the skipped minutes at the first minute that exists", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await saveWeek(
        tx,
        f.cfg,
        f.upstairs,
        configuredWeek({
          [weekdayOf(forward.date)]: periodsCell([
            minutesAfter(forward.before, 16),
            minutesAfter(forward.after, 60),
          ]),
        }),
      );
      expect(
        await statusAt(tx, f.cfg, f.upstairs, new Date(forward.instant.getTime() - minute)),
      ).toEqual(outOfHours);
      expect(await statusAt(tx, f.cfg, f.upstairs, forward.instant)).toEqual(inHours);
      expect(
        (
          await routingModel(tx, f.cfg, new Date(forward.instant.getTime() - 30 * minute))
        ).stationTimes.find((row) => row.stationId === f.upstairs)?.nextTransition,
      ).toEqual({ weekday: weekdayOf(forward.date), timeOfDay: forward.after, daysAhead: 0 });
    });
  });

  it("gives both occurrences of a repeated minute the same answer", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await saveWeek(
        tx,
        f.cfg,
        f.upstairs,
        configuredWeek({
          [weekdayOf(backward.date)]: periodsCell([
            backward.after,
            minutesAfter(backward.after, 30),
          ]),
        }),
      );
      const repeat = backward.deltaMinutes * minute;
      // The first pass through the repeated hour, then the second.
      const first = (minutes: number) =>
        new Date(backward.instant.getTime() - repeat + minutes * minute);
      const second = (minutes: number) => new Date(backward.instant.getTime() + minutes * minute);
      expect(await statusAt(tx, f.cfg, f.upstairs, first(15))).toEqual(inHours);
      expect(await statusAt(tx, f.cfg, f.upstairs, second(15))).toEqual(inHours);
      expect(await statusAt(tx, f.cfg, f.upstairs, first(45))).toEqual(outOfHours);
      expect(await statusAt(tx, f.cfg, f.upstairs, second(45))).toEqual(outOfHours);
    });
  });
});

describe("station times on a public holiday", () => {
  // The file shares one taxpayer row; put back whatever it held before a case placed it in Spain.
  let tenantBefore: (typeof tenants.$inferSelect)[] = [];
  beforeAll(async () => {
    tenantBefore = await db.transaction((tx) => tx.select().from(tenants));
  });
  afterEach(async () => {
    await db.transaction(async (tx) => {
      await tx.delete(tenants);
      if (tenantBefore.length > 0) await tx.insert(tenants).values(tenantBefore);
    });
  });

  /** The fixture's venue, in Seville, Spain. */
  async function sevilleVenue(tx: Transaction) {
    const f = await fixture(tx);
    await tx
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "X0000000", legalName: "Invented SL" })
      .onConflictDoUpdate({ target: tenants.id, set: { country: "ES" } });
    await tx
      .update(locations)
      .set({ province: "Sevilla", city: "Sevilla" })
      .where(eq(locations.id, f.cfg.locationId));
    return f;
  }

  // Monday 12 October 2026, Spain's national day, against the ordinary Monday a week before, at
  // 12:00, 18:00, 22:59 and 23:00 in Seville (two hours ahead of UTC).
  const HOLIDAY = "2026-10-12";
  const ORDINARY = "2026-10-05";
  const TIMES = ["10:00", "16:00", "20:59", "21:00"];

  it("follows only the station's own Hours on a Spanish national holiday, as on an ordinary Monday", async () => {
    await db.transaction(async (tx) => {
      const f = await sevilleVenue(tx);
      expect(await readHolidayFacts(tx, f.cfg, HOLIDAY, HOLIDAY)).toEqual([
        expect.objectContaining({ date: HOLIDAY, scope: "national" }),
      ]);
      expect(await readHolidayFacts(tx, f.cfg, ORDINARY, ORDINARY)).toEqual([]);
      await saveWeek(tx, f.cfg, f.upstairs, configuredWeek({ 1: periodsCell(["18:00", "23:00"]) }));
      await setStationFallback(tx, f.cfg, f.upstairs, f.downstairs);

      const times = async (date: string, time: string) =>
        (await routingModel(tx, f.cfg, new Date(`${date}T${time}:00Z`))).stationTimes;
      for (const time of TIMES)
        expect(await times(HOLIDAY, time)).toEqual(await times(ORDINARY, time));
      expect(await statusAt(tx, f.cfg, f.upstairs, `${HOLIDAY}T18:00:00Z`)).toEqual(inHours);
      expect(await statusAt(tx, f.cfg, f.upstairs, `${HOLIDAY}T10:00:00Z`)).toEqual(outOfHours);
      expect(
        (await times(HOLIDAY, "18:00")).find((row) => row.stationId === f.upstairs)
          ?.specialDateRestricts,
      ).toBe(false);
    });
  });

  it("closes a station on the holiday only once the venue saves a special date there", async () => {
    await db.transaction(async (tx) => {
      const f = await sevilleVenue(tx);
      await saveWeek(tx, f.cfg, f.upstairs, configuredWeek({ 1: periodsCell(["18:00", "23:00"]) }));
      await saveDate(tx, f.cfg, HOLIDAY, [[f.upstairs, closedDate]]);
      expect(await statusAt(tx, f.cfg, f.upstairs, `${HOLIDAY}T18:00:00Z`)).toEqual(outOfHours);
      expect(await statusAt(tx, f.cfg, f.upstairs, `${ORDINARY}T18:00:00Z`)).toEqual(inHours);
    });
  });
});

describe("station today controls", () => {
  const at = new Date("2026-10-02T18:00:00Z");

  async function todayRows(stationId: string) {
    return db.transaction((tx) =>
      tx.select().from(stationDayStates).where(eq(stationDayStates.stationId, stationId)),
    );
  }

  it("closes with a destination and replaces the destination on a later close", async () => {
    const f = await db.transaction(fixture);
    await db.transaction((tx) =>
      stationTimes.closeStationForToday(tx, f.cfg, f.upstairs, f.downstairs, at),
    );
    expect(await todayRows(f.upstairs)).toEqual([
      expect.objectContaining({
        businessDay: "2026-10-02",
        open: false,
        sendsToStationId: f.downstairs,
      }),
    ]);
    await db.transaction((tx) =>
      stationTimes.closeStationForToday(tx, f.cfg, f.upstairs, f.kitchen, at),
    );
    expect(await todayRows(f.upstairs)).toEqual([
      expect.objectContaining({
        businessDay: "2026-10-02",
        open: false,
        sendsToStationId: f.kitchen,
      }),
    ]);
  });

  it.each([
    ["missing", "station.not_found"],
    ["otherStation", "station.not_found"],
    ["retired", "route.station_inactive"],
    ["kitchen", "station.always_open"],
  ] as const)(
    "refuses to close the %s source before validating the destination",
    async (key, code) => {
      const f = await db.transaction(fixture);
      const source = key === "missing" ? randomUUID() : f[key];
      await expect(
        db.transaction((tx) => stationTimes.closeStationForToday(tx, f.cfg, source, source, at)),
      ).rejects.toMatchObject({ code, params: { stationId: source } });
      expect(await todayRows(source)).toEqual([]);
    },
  );

  it.each([
    ["upstairs", "self"],
    ["retired", "inactive"],
    ["otherStation", "unknown"],
    ["missing", "unknown"],
    ["downstairs", "closed"],
  ] as const)("refuses the %s destination and retains the previous close", async (key, reason) => {
    const f = await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await setStationToday(tx, f.cfg, f.upstairs, "closed", at);
      await setStationToday(tx, f.cfg, f.downstairs, "closed", at);
      return f;
    });
    const destination = key === "missing" ? randomUUID() : f[key];
    const before = await todayRows(f.upstairs);
    await expect(
      db.transaction((tx) =>
        stationTimes.closeStationForToday(tx, f.cfg, f.upstairs, destination, at),
      ),
    ).rejects.toMatchObject({
      code: "station.destination_invalid",
      params: { stationId: f.upstairs, sendsToStationId: destination, reason },
    });
    expect(await todayRows(f.upstairs)).toEqual(before);
  });

  it("refuses an out-of-hours destination", async () => {
    const f = await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await seedStationWeek(tx, f.cfg, f.downstairs, [
        { weekday: 5, opensAt: "21:00", closesAt: "23:00" },
      ]);
      return f;
    });
    await expect(
      db.transaction((tx) =>
        stationTimes.closeStationForToday(tx, f.cfg, f.upstairs, f.downstairs, at),
      ),
    ).rejects.toMatchObject({ code: "station.destination_invalid", params: { reason: "closed" } });
    expect(await todayRows(f.upstairs)).toEqual([]);
  });

  it("offers the default first, then display order and name, leaving out unusable destinations", async () => {
    const f = await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await setStationToday(tx, f.cfg, f.downstairs, "closed", at);
      await tx.insert(kitchenStations).values([
        { ...f.cfg, name: "Beta", displayOrder: 2, id: "00000000-0000-4000-8000-000000000003" },
        { ...f.cfg, name: "Zulu", displayOrder: 1, id: "00000000-0000-4000-8000-000000000001" },
        { ...f.cfg, name: "Alpha", displayOrder: 2, id: "00000000-0000-4000-8000-000000000002" },
      ]);
      await tx
        .update(kitchenStations)
        .set({ displayOrder: 9 })
        .where(eq(kitchenStations.id, f.kitchen));
      return f;
    });
    expect(
      await db.transaction((tx) => stationTimes.stationDestinations(tx, f.cfg, f.upstairs, at)),
    ).toEqual([
      { id: f.kitchen, name: "Kitchen", isDefault: true },
      { id: "00000000-0000-4000-8000-000000000001", name: "Zulu", isDefault: false },
      { id: "00000000-0000-4000-8000-000000000002", name: "Alpha", isDefault: false },
      { id: "00000000-0000-4000-8000-000000000003", name: "Beta", isDefault: false },
    ]);
  });

  it("offers a destination opened by hand outside its hours, but not after cutover", async () => {
    const f = await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await seedStationWeek(tx, f.cfg, f.downstairs, [
        { weekday: 5, opensAt: "21:00", closesAt: "23:00" },
      ]);
      await setStationToday(tx, f.cfg, f.downstairs, "open", at);
      return f;
    });
    expect(
      await db.transaction((tx) => stationTimes.stationDestinations(tx, f.cfg, f.upstairs, at)),
    ).toEqual([
      { id: f.kitchen, name: "Kitchen", isDefault: true },
      { id: f.downstairs, name: "Downstairs bar", isDefault: false },
    ]);
    expect(
      await db.transaction((tx) =>
        stationTimes.stationDestinations(tx, f.cfg, f.upstairs, new Date("2026-10-03T04:00:00Z")),
      ),
    ).toEqual([{ id: f.kitchen, name: "Kitchen", isDefault: true }]);
  });

  it("reopens within scheduled hours by removing today's row, so the scheduled closing still applies", async () => {
    const f = await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await seedStationWeek(tx, f.cfg, f.upstairs, [
        { weekday: 5, opensAt: "19:00", closesAt: "21:00" },
      ]);
      await setStationToday(tx, f.cfg, f.upstairs, "closed", at);
      return f;
    });
    await db.transaction((tx) => stationTimes.openStationForToday(tx, f.cfg, f.upstairs, at));
    expect(await todayRows(f.upstairs)).toEqual([]);
    const model = await db.transaction((tx) =>
      routingModel(tx, f.cfg, new Date("2026-10-02T19:00:00Z")),
    );
    expect(model.stationTimes.find((row) => row.stationId === f.upstairs)?.status).toEqual({
      open: false,
      why: "out_of_hours",
    });
  });

  it("reopens outside scheduled hours with an open row and clears its destination", async () => {
    const f = await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await seedStationWeek(tx, f.cfg, f.upstairs, [
        { weekday: 5, opensAt: "21:00", closesAt: "23:00" },
      ]);
      return f;
    });
    await db.transaction((tx) =>
      stationTimes.closeStationForToday(tx, f.cfg, f.upstairs, f.downstairs, at),
    );
    await db.transaction((tx) => stationTimes.openStationForToday(tx, f.cfg, f.upstairs, at));
    expect(await todayRows(f.upstairs)).toEqual([
      expect.objectContaining({ businessDay: "2026-10-02", open: true, sendsToStationId: null }),
    ]);
    const model = await db.transaction((tx) => routingModel(tx, f.cfg, at));
    expect(model.stationTimes.find((row) => row.stationId === f.upstairs)?.status).toEqual({
      open: true,
      why: "opened_by_hand",
    });
  });

  it.each([
    ["missing", "station.not_found"],
    ["otherStation", "station.not_found"],
    ["retired", "route.station_inactive"],
  ] as const)("refuses to open the %s source", async (key, code) => {
    const f = await db.transaction(fixture);
    const source = key === "missing" ? randomUUID() : f[key];
    await expect(
      db.transaction((tx) => stationTimes.openStationForToday(tx, f.cfg, source, at)),
    ).rejects.toMatchObject({ code, params: { stationId: source } });
    expect(await todayRows(source)).toEqual([]);
  });

  it("reopens a station with no hours by removing the by-hand close", async () => {
    const f = await db.transaction(fixture);
    await db.transaction((tx) => setStationToday(tx, f.cfg, f.upstairs, "closed", at));
    await db.transaction((tx) => stationTimes.openStationForToday(tx, f.cfg, f.upstairs, at));
    expect(await todayRows(f.upstairs)).toEqual([]);
  });

  it.each(["close", "open"] as const)(
    "refuses %s when the clock is unreadable without changing the previous row",
    async (action) => {
      const f = await db.transaction(async (tx) => {
        const f = await fixture(tx);
        await setStationToday(tx, f.cfg, f.upstairs, "closed", at);
        await tx
          .update(locations)
          .set({ timeZone: "Mars/Base" })
          .where(eq(locations.id, f.cfg.locationId));
        return f;
      });
      const before = await todayRows(f.upstairs);
      await expect(
        db.transaction((tx) =>
          action === "close"
            ? stationTimes.closeStationForToday(tx, f.cfg, f.upstairs, f.downstairs, at)
            : stationTimes.openStationForToday(tx, f.cfg, f.upstairs, at),
        ),
      ).rejects.toMatchObject({ code: "time_zone.unreadable" });
      expect(await todayRows(f.upstairs)).toEqual(before);
    },
  );
});
