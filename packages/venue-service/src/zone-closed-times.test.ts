import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, floorZones, locations, withTransaction } from "@waitron/db";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { configureZone, createDepartment, deactivateDepartment } from "./operations.js";
import { saveSpecialDate, duplicateSpecialDate } from "./hours.js";
import { VENUE_SERVICE_CALENDAR_PARTICIPANTS } from "./calendar-participants.js";
import { readOpeningHoursModel } from "./menu-timetable.js";
import { zoneClosedTimes } from "./schema/zone-closed-times.js";
import * as closures from "./zone-closed-times.js";
import { listZoneOffers, menuState } from "./operations.js";
import { VENUE_SERVICE } from "./service.js";
import { replaceZoneClosedWeek, saveZoneClosedDate } from "./zone-closed-times.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
const at = new Date("2030-10-07T10:00:00Z");
const night = [{ startsAt: "23:00", endsAt: "06:00" }];
const week = (ranges = night) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: weekday === 1 ? ranges : [] }));
const tx = <T>(body: Parameters<typeof withTransaction<T>>[1]) => withTransaction(suite.db, body);
async function venue() {
  return tx(async (db) => {
    const [row] = await db
      .insert(locations)
      .values({
        name: randomUUID(),
        timeZone: "Europe/Madrid",
        dayCutover: "06:00",
        invoiceLocales: ["es-ES"],
        operationDescription: "Restaurant",
      })
      .returning();
    const cfg = { locationId: locationId(row!.id) };
    const departmentId = (
      await createDepartment(db, cfg, { name: "Dining", defaultServiceMode: "table_tab" })
    ).id;
    const zone = async (name: string, displayOrder: number, active = true) => {
      const [z] = await db
        .insert(floorZones)
        .values({ locationId: cfg.locationId, name, displayOrder, active })
        .returning();
      await configureZone(db, cfg, { zoneId: z!.id, departmentId });
      return z!.id;
    };
    const terrace = await zone("Terrace", 2);
    const bar = await zone("Bar", 1);
    await zone("Disabled", 0, false);
    return { cfg, departmentId, terrace, bar };
  });
}
async function named(v: Awaited<ReturnType<typeof venue>>, ownHours: boolean) {
  return tx((db) =>
    saveSpecialDate(
      db,
      v.cfg,
      null,
      { date: "2030-12-25", name: "Christmas", ownHours, closeWholeVenue: false, cells: [] },
      at,
    ),
  );
}
describe("zone closed times", () => {
  it("replaces only a zone's normal week, including clearing empty days", async () => {
    const v = await venue();
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week()));
    await tx((db) =>
      replaceZoneClosedWeek(db, v.cfg, v.bar, week([{ startsAt: "06:00", endsAt: "06:00" }])),
    );
    const day = await named(v, true);
    await tx((db) => saveZoneClosedDate(db, v.cfg, day.id, v.terrace, night));
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week([])));
    const model = await tx((db) => readOpeningHoursModel(db, v.cfg, at));
    expect(model.departments.find((d) => d.id === v.departmentId)!.zones).toEqual([
      { id: v.bar, name: "Bar", week: week([{ startsAt: "06:00", endsAt: "06:00" }]), dates: [] },
      {
        id: v.terrace,
        name: "Terrace",
        week: week([]),
        dates: [{ specialDateId: day.id, ranges: night }],
      },
    ]);
  });
  it("replaces dated closures, copies them with a named day, and clears just that date", async () => {
    const v = await venue(),
      day = await named(v, true);
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week()));
    await tx((db) =>
      saveZoneClosedDate(db, v.cfg, day.id, v.terrace, [{ startsAt: "12:00", endsAt: "14:00" }]),
    );
    await tx((db) => saveZoneClosedDate(db, v.cfg, day.id, v.terrace, night));
    const [copy] = await tx((db) =>
      duplicateSpecialDate(
        db,
        v.cfg,
        day.id,
        ["2030-12-26"],
        at,
        VENUE_SERVICE_CALENDAR_PARTICIPANTS,
      ),
    );
    await tx((db) => saveZoneClosedDate(db, v.cfg, day.id, v.terrace, []));
    const model = await tx((db) => readOpeningHoursModel(db, v.cfg, at));
    const zone = model.departments
      .find((d) => d.id === v.departmentId)!
      .zones.find((z) => z.id === v.terrace)!;
    expect(zone.week).toEqual(week());
    expect(zone.dates).toEqual([{ specialDateId: copy!.id, ranges: night }]);
  });
  it("refuses a foreign or switched-off department's zone without changing its rows", async () => {
    const a = await venue(),
      b = await venue();
    await tx((db) => replaceZoneClosedWeek(db, b.cfg, b.terrace, week()));
    await expect(
      tx((db) => replaceZoneClosedWeek(db, a.cfg, b.terrace, week([]))),
    ).rejects.toMatchObject({ code: "service_zone.not_found", params: { zoneId: b.terrace } });
    await tx((db) => createDepartment(db, b.cfg, { name: "Other", defaultServiceMode: "prepay" }));
    await tx((db) => deactivateDepartment(db, b.cfg, b.departmentId));
    await expect(
      tx((db) => replaceZoneClosedWeek(db, b.cfg, b.terrace, week([]))),
    ).rejects.toMatchObject({ code: "service_zone.not_found" });
    expect(
      await suite.db
        .select({ weekday: zoneClosedTimes.weekday })
        .from(zoneClosedTimes)
        .where(eq(zoneClosedTimes.zoneId, b.terrace)),
    ).toEqual([{ weekday: 1 }]);
  });
  it("refuses keeping-week and foreign named days before writing dated rows", async () => {
    const a = await venue(),
      b = await venue(),
      day = await named(a, false),
      foreign = await named(b, true);
    await expect(
      tx((db) => saveZoneClosedDate(db, a.cfg, day.id, a.terrace, night)),
    ).rejects.toMatchObject({ code: "special_date.keeps_week", params: { specialDateId: day.id } });
    await expect(
      tx((db) => saveZoneClosedDate(db, a.cfg, foreign.id, a.terrace, night)),
    ).rejects.toMatchObject({
      code: "special_date.not_found",
      params: { specialDateId: foreign.id },
    });
    const own = await tx((db) =>
      saveSpecialDate(
        db,
        a.cfg,
        day.id,
        {
          date: "2030-12-25",
          name: "Christmas",
          ownHours: true,
          closeWholeVenue: false,
          cells: [],
        },
        at,
      ),
    );
    await expect(
      tx((db) => saveZoneClosedDate(db, a.cfg, own.id, b.terrace, night)),
    ).rejects.toMatchObject({ code: "service_zone.not_found" });
  });
  it.each([
    null,
    [],
    week().slice(0, 6),
    [...week().slice(0, 6), { weekday: 5, ranges: [] }],
    [...week().slice(0, 6), { weekday: "6", ranges: [] }],
    [...week().slice(0, 6), null],
  ])("refuses an incomplete or malformed week %j without deleting data", async (days) => {
    const v = await venue();
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week()));
    await expect(
      tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, days)),
    ).rejects.toMatchObject({ code: "zone_closed_time.invalid" });
    const model = await tx((db) => readOpeningHoursModel(db, v.cfg, at));
    expect(
      model.departments.find((d) => d.id === v.departmentId)!.zones.find((z) => z.id === v.terrace)!
        .week,
    ).toEqual(week());
  });
});

describe("zones closed at an instant", () => {
  const mondayNight = [{ startsAt: "23:30", endsAt: "06:00" }];
  it.each([
    ["2030-10-07T21:29:00Z", false],
    ["2030-10-07T21:30:00Z", true],
    ["2030-10-08T00:00:00Z", true],
    ["2030-10-08T04:00:00Z", false],
  ])("uses the business day's half-open range at %s", async (instant, closed) => {
    const v = await venue();
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week(mondayNight)));
    expect([...(await tx((db) => closures.closedZoneIdsAt(db, v.cfg, new Date(instant))))]).toEqual(
      closed ? [v.terrace] : [],
    );
  });
  it.each([
    ["2030-10-08T00:59:00Z", true],
    ["2030-10-08T01:00:00Z", false],
  ])("excludes the overnight end inside a business day at %s", async (instant, closed) => {
    const v = await venue();
    await tx((db) =>
      replaceZoneClosedWeek(db, v.cfg, v.terrace, week([{ startsAt: "23:30", endsAt: "03:00" }])),
    );
    expect([...(await tx((db) => closures.closedZoneIdsAt(db, v.cfg, new Date(instant))))]).toEqual(
      closed ? [v.terrace] : [],
    );
  });
  it("uses dated closures instead of the week, including an empty zone override", async () => {
    const v = await venue();
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week(mondayNight)));
    const day = await tx((db) =>
      saveSpecialDate(
        db,
        v.cfg,
        null,
        {
          date: "2030-10-07",
          name: "Own Monday",
          ownHours: true,
          closeWholeVenue: false,
          cells: [],
        },
        at,
        VENUE_SERVICE_CALENDAR_PARTICIPANTS,
      ),
    );
    await tx((db) => saveZoneClosedDate(db, v.cfg, day.id, v.terrace, []));
    await tx((db) => saveZoneClosedDate(db, v.cfg, day.id, v.bar, mondayNight));
    expect([
      ...(await tx((db) => closures.closedZoneIdsAt(db, v.cfg, new Date("2030-10-08T00:00:00Z")))),
    ]).toEqual([v.bar]);
  });
  it("keeps the week's closures on a repeating day without own hours", async () => {
    const v = await venue();
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week(mondayNight)));
    await tx((db) =>
      saveSpecialDate(
        db,
        v.cfg,
        null,
        {
          date: "2030-10-07",
          name: "Annual Monday",
          repeats: true,
          ownHours: false,
          closeWholeVenue: false,
          cells: [],
        },
        at,
      ),
    );
    expect([
      ...(await tx((db) => closures.closedZoneIdsAt(db, v.cfg, new Date("2041-10-07T21:45:00Z")))),
    ]).toEqual([v.terrace]);
  });
  it("scopes the batch to this location and the selected zones", async () => {
    const v = await venue(),
      other = await venue();
    for (const [cfg, id] of [
      [v.cfg, v.terrace],
      [v.cfg, v.bar],
      [other.cfg, other.terrace],
    ] as const)
      await tx((db) => replaceZoneClosedWeek(db, cfg, id, week(mondayNight)));
    const instant = new Date("2030-10-07T21:45:00Z");
    expect([
      ...(await tx((db) =>
        closures.closedZoneIdsAt(db, v.cfg, instant, [v.terrace, other.terrace]),
      )),
    ]).toEqual([v.terrace]);
    expect([...(await tx((db) => closures.closedZoneIdsAt(db, v.cfg, instant, [])))]).toEqual([]);
  });
  it("whole-venue closure and an unreadable clock leave zone-only state open", async () => {
    const v = await venue();
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week(mondayNight)));
    await tx((db) =>
      saveSpecialDate(
        db,
        v.cfg,
        null,
        {
          date: "2030-10-07",
          name: "Closed",
          ownHours: false,
          closeWholeVenue: true,
          cells: [],
        },
        at,
      ),
    );
    const instant = new Date("2030-10-07T21:45:00Z");
    expect([...(await tx((db) => closures.closedZoneIdsAt(db, v.cfg, instant)))]).toEqual([]);
    await tx((db) =>
      db
        .update(locations)
        .set({ timeZone: "unreadable" })
        .where(eq(locations.id, v.cfg.locationId)),
    );
    expect([...(await tx((db) => closures.closedZoneIdsAt(db, v.cfg, instant)))]).toEqual([]);
  });
  it("reports closure separately from department opening and refuses only the closed zone", async () => {
    const v = await venue();
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week(mondayNight)));
    const instant = new Date("2030-10-07T21:45:00Z");
    const offers = await tx((db) => listZoneOffers(db, v.cfg, v.terrace, { at: instant }));
    const state = await tx((db) => menuState(db, v.cfg, v.terrace, instant));
    expect(offers.service).toMatchObject({ open: false, zoneOpen: false });
    expect(state.service).toMatchObject({ open: false, zoneOpen: false });
    await expect(
      tx((db) => VENUE_SERVICE.assertZoneTakesNewOrders(db, v.cfg, v.terrace, instant)),
    ).rejects.toMatchObject({ code: "service_zone.closed", params: { zoneId: v.terrace } });
    await expect(
      tx((db) => VENUE_SERVICE.assertZoneTakesNewOrders(db, v.cfg, v.bar, instant)),
    ).resolves.toBeUndefined();
  });
  it("reads the clock, named day and closed times once for a batch", async () => {
    const v = await venue();
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week(mondayNight)));
    await tx(async (db) => {
      const session = (
        db as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
      ).session;
      const spy = vi.spyOn(session, "prepareQuery");
      try {
        const closed = await closures.closedZoneIdsAt(db, v.cfg, new Date("2030-10-07T21:45:00Z"), [
          v.bar,
          v.terrace,
        ]);
        expect([...closed]).toEqual([v.terrace]);
        const texts = spy.mock.calls.map(([query]) => (query as unknown as { sql: string }).sql);
        for (const table of ["locations", "special_dates", "zone_closed_times"])
          expect(texts.filter((text) => text.includes(`from "${table}"`))).toHaveLength(1);
        expect(texts).toHaveLength(3);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
