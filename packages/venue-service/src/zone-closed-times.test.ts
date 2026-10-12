import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  floorZones,
  locations,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { configureZone, createDepartment } from "./operations.js";
import { saveSpecialDate, duplicateSpecialDate } from "./hours.js";
import { VENUE_SERVICE_CALENDAR_PARTICIPANTS } from "./calendar-participants.js";
import { readOpeningHoursModel } from "./menu-timetable.js";
import { zoneClosedTimes } from "./schema/zone-closed-times.js";
import * as closures from "./zone-closed-times.js";
import { listZoneOffers, menuState } from "./operations.js";
import { VENUE_SERVICE } from "./service.js";
import { replaceZoneClosedWeek, saveZoneClosedDate } from "./zone-closed-times.js";
import { ensureDefaultSeasons } from "./seasons.js";

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
    const departmentId = (await createDepartment(db, cfg, { name: "Dining", orderStart: "table" }))
      .id;
    const zone = async (name: string, displayOrder: number, active = true) => {
      const [z] = await db
        .insert(floorZones)
        .values({ locationId: cfg.locationId, name, displayOrder })
        .returning();
      await configureZone(db, cfg, { zoneId: z!.id, departmentId });
      if (!active)
        await db.update(floorZones).set({ active: false }).where(eq(floorZones.id, z!.id));
      return z!.id;
    };
    const terrace = await zone("Terrace", 2);
    const bar = await zone("Bar", 1);
    const disabled = await zone("Disabled", 0, false);
    return { cfg, departmentId, terrace, bar, disabled };
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
      undefined,
      0,
    ),
  );
}
describe("zone closed times", () => {
  it("replaces only a zone's normal week, including clearing empty days", async () => {
    const v = await venue();
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week(), 0));
    await tx((db) =>
      replaceZoneClosedWeek(db, v.cfg, v.bar, week([{ startsAt: "06:00", endsAt: "06:00" }]), 0),
    );
    const day = await named(v, true);
    await tx((db) => saveZoneClosedDate(db, v.cfg, day.id, v.terrace, night, 0));
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week([]), 0));
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
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week(), 0));
    await tx((db) =>
      saveZoneClosedDate(db, v.cfg, day.id, v.terrace, [{ startsAt: "12:00", endsAt: "14:00" }], 0),
    );
    await tx((db) => saveZoneClosedDate(db, v.cfg, day.id, v.terrace, night, 0));
    const [copy] = await tx((db) =>
      duplicateSpecialDate(
        db,
        v.cfg,
        day.id,
        ["2030-12-26"],
        at,
        VENUE_SERVICE_CALENDAR_PARTICIPANTS,
        0,
      ),
    );
    await tx((db) => saveZoneClosedDate(db, v.cfg, day.id, v.terrace, [], 0));
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
    await tx((db) => replaceZoneClosedWeek(db, b.cfg, b.terrace, week(), 0));
    await expect(
      tx((db) => replaceZoneClosedWeek(db, a.cfg, b.terrace, week([]), 0)),
    ).rejects.toMatchObject({ code: "service_zone.not_found", params: { zoneId: b.terrace } });
    await tx((db) => createDepartment(db, b.cfg, { name: "Other", orderStart: "counter" }));
    await tx((db) =>
      (async () => {
        await db.execute(
          sql`update floor_zones set active = false where id in (select zone_id from zone_service_policies where department_id = ${b.departmentId})`,
        );
        await db.execute(sql`update departments set active = false where id = ${b.departmentId}`);
      })(),
    );
    await expect(
      tx((db) => replaceZoneClosedWeek(db, b.cfg, b.terrace, week([]), 0)),
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
      tx((db) => saveZoneClosedDate(db, a.cfg, day.id, a.terrace, night, 0)),
    ).rejects.toMatchObject({ code: "special_date.keeps_week", params: { specialDateId: day.id } });
    await expect(
      tx((db) => saveZoneClosedDate(db, a.cfg, foreign.id, a.terrace, night, 0)),
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
        undefined,
        0,
      ),
    );
    await expect(
      tx((db) => saveZoneClosedDate(db, a.cfg, own.id, b.terrace, night, 0)),
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
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week(), 0));
    await expect(
      tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, days, 0)),
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
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week(mondayNight), 0));
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
      replaceZoneClosedWeek(
        db,
        v.cfg,
        v.terrace,
        week([{ startsAt: "23:30", endsAt: "03:00" }]),
        0,
      ),
    );
    expect([...(await tx((db) => closures.closedZoneIdsAt(db, v.cfg, new Date(instant))))]).toEqual(
      closed ? [v.terrace] : [],
    );
  });
  it("uses dated closures instead of the week, including an empty zone override", async () => {
    const v = await venue();
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week(mondayNight), 0));
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
        0,
      ),
    );
    await tx((db) => saveZoneClosedDate(db, v.cfg, day.id, v.terrace, [], 0));
    await tx((db) => saveZoneClosedDate(db, v.cfg, day.id, v.bar, mondayNight, 0));
    expect([
      ...(await tx((db) => closures.closedZoneIdsAt(db, v.cfg, new Date("2030-10-08T00:00:00Z")))),
    ]).toEqual([v.bar]);
  });
  it("keeps the week's closures on a repeating day without own hours", async () => {
    const v = await venue();
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week(mondayNight), 0));
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
        undefined,
        0,
      ),
    );
    expect([
      ...(await tx((db) => closures.closedZoneIdsAt(db, v.cfg, new Date("2041-10-07T21:45:00Z")))),
    ]).toEqual([v.terrace]);
  });
  it("closes a zone by the season of the business day", async () => {
    const v = await venue();
    const seasons = await tx((db) => ensureDefaultSeasons(db, v.cfg));
    const winter = seasons.find((season) => season.name === "Winter")!.id;
    const friday = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      ranges: weekday === 5 ? [{ startsAt: "22:00", endsAt: "23:30" }] : [],
    }));
    await tx((db) =>
      replaceZoneClosedWeek(db, v.cfg, v.terrace, friday, 0, at, { seasonId: winter }),
    );
    const closedAt = (instant: string) =>
      tx((db) => closures.closedZoneIdsAt(db, v.cfg, new Date(instant)));
    // 22:30 in Madrid on Friday 29 November (Autumn) and Friday 6 December 2030 (Winter).
    expect([...(await closedAt("2030-11-29T21:30:00Z"))]).toEqual([]);
    expect([...(await closedAt("2030-12-06T21:30:00Z"))]).toEqual([v.terrace]);
  });
  it("scopes the batch to this location and the selected zones", async () => {
    const v = await venue(),
      other = await venue();
    for (const [cfg, id] of [
      [v.cfg, v.terrace],
      [v.cfg, v.bar],
      [other.cfg, other.terrace],
    ] as const)
      await tx((db) => replaceZoneClosedWeek(db, cfg, id, week(mondayNight), 0));
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
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week(mondayNight), 0));
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
        undefined,
        0,
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
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week(mondayNight), 0));
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
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week(mondayNight), 0));
    const reads = (zoneIds: string[]) =>
      tx(async (db) => {
        const session = (
          db as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
        ).session;
        const spy = vi.spyOn(session, "prepareQuery");
        try {
          const closed = await closures.closedZoneIdsAt(
            db,
            v.cfg,
            new Date("2030-10-07T21:45:00Z"),
            zoneIds,
          );
          expect([...closed]).toEqual([v.terrace]);
          return spy.mock.calls.map(([query]) => (query as unknown as { sql: string }).sql);
        } finally {
          spy.mockRestore();
        }
      });
    const one = await reads([v.terrace]);
    const three = await reads([v.bar, v.terrace, v.disabled]);
    for (const texts of [one, three]) {
      for (const table of ["locations", "seasons", "special_dates", "zone_days", "zone_extensions"])
        expect(texts.filter((text) => text.includes(`from "${table}"`))).toHaveLength(1);
      expect(texts.filter((text) => text.includes(`from "zone_closed_times"`))).toHaveLength(0);
      expect(texts).toHaveLength(5);
    }
    expect(three).toHaveLength(one.length);
  });
  it("reads several zones' floor closing summaries in the statements one zone takes, answering as one zone at a time does", async () => {
    const v = await venue();
    await tx((db) => replaceZoneClosedWeek(db, v.cfg, v.terrace, week(mondayNight), 0));
    await tx((db) =>
      replaceZoneClosedWeek(db, v.cfg, v.bar, week([{ startsAt: "23:45", endsAt: "02:00" }]), 0),
    );
    const instant = new Date("2030-10-07T21:40:00Z");
    const ids = [v.terrace, v.bar, v.disabled];
    const single = await tx(async (db) => {
      const answers = new Map<string, unknown>();
      for (const id of ids)
        answers.set(id, await VENUE_SERVICE.readZoneKeepOpenState(db, v.cfg, id, instant));
      return answers;
    });
    expect(single).toEqual(
      new Map([
        [
          v.terrace,
          {
            zoneId: v.terrace,
            zoneName: "Terrace",
            closesAt: "23:30",
            running: false,
            extendedUntil: null,
          },
        ],
        [
          v.bar,
          { zoneId: v.bar, zoneName: "Bar", closesAt: "23:45", running: true, extendedUntil: null },
        ],
        [v.disabled, null],
      ]),
    );
    const counted = <T>(read: (db: Transaction) => Promise<T>) =>
      tx(async (db) => {
        const session = (
          db as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
        ).session;
        const spy = vi.spyOn(session, "prepareQuery");
        try {
          const answers = await read(db);
          return {
            answers,
            texts: spy.mock.calls.map(([query]) => (query as unknown as { sql: string }).sql),
          };
        } finally {
          spy.mockRestore();
        }
      });
    const batch = (zoneIds: string[]) =>
      counted((db) => VENUE_SERVICE.readZoneClosingStates(db, v.cfg, zoneIds, instant));
    const keepOpen = (states: ReadonlyMap<string, { keepOpen: unknown }>) =>
      new Map([...states].map(([id, state]) => [id, state.keepOpen]));
    const one = await batch([v.terrace]);
    const three = await batch(ids);
    expect(keepOpen(one.answers)).toEqual(new Map([[v.terrace, single.get(v.terrace)]]));
    expect(keepOpen(three.answers)).toEqual(single);
    expect(three.texts).toHaveLength(one.texts.length);
    expect((await batch([])).answers).toEqual(new Map());
    const closedOnly = await counted((db) =>
      VENUE_SERVICE.closedZoneIdsAt(db, v.cfg, instant, ids),
    );
    expect(new Map([...three.answers].map(([id, state]) => [id, state.closed]))).toEqual(
      new Map(ids.map((id) => [id, closedOnly.answers.has(id)])),
    );
    expect([...closedOnly.answers]).toEqual([v.terrace]);
    // Beyond the closed check, the summaries cost only the read of the closing zones' names.
    expect(three.texts).toHaveLength(closedOnly.texts.length + 1);
  });
});

it.each([
  { extension: null, want: [{ startsAt: "23:30", endsAt: "06:00" }] },
  {
    extension: { startsAt: "21:00", endsAt: "22:00" },
    want: [{ startsAt: "23:30", endsAt: "06:00" }],
  },
  { extension: { startsAt: "23:30", endsAt: "06:00" }, want: [] },
  {
    extension: { startsAt: "00:00", endsAt: "01:30" },
    want: [
      { startsAt: "23:30", endsAt: "00:00" },
      { startsAt: "01:30", endsAt: "06:00" },
    ],
  },
])("carves only the extension span from closed ranges $extension", ({ extension, want }) => {
  expect(
    closures.withoutZoneExtension([{ startsAt: "23:30", endsAt: "06:00" }], extension, "06:00"),
  ).toEqual(want);
});
