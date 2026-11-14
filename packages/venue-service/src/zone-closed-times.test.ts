import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  floorZones,
  seasons,
  withTransaction,
  type Transaction,
  zoneDayRanges,
  zoneDays,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue, seedZone } from "@waitron/db/testing/seed.js";
import { configureZone, createDepartment } from "./operations.js";
import { readOpeningHoursModel } from "./menu-timetable.js";
import * as closures from "./zone-closed-times.js";
import { listZoneOffers, menuState } from "./operations.js";
import { VENUE_SERVICE } from "./service.js";
import { replaceZoneClosedWeek } from "./zone-closed-times.js";
import { ensureDefaultSeasons } from "./seasons.js";
import type { ZonePaint } from "./day-paint.js";
import { readSpecialDay, saveSpecialDay } from "./special-days.js";
import { starterSeasonName } from "./testing/starter-seasons.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
});
const at = new Date("2030-10-07T10:00:00Z");
const night = [{ startsAt: "23:00", endsAt: "06:00" }];
const week = (ranges = night) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: weekday === 1 ? ranges : [] }));
const tx = <T>(body: Parameters<typeof withTransaction<T>>[1]) => withTransaction(suite.db, body);
async function venue() {
  return tx(async (db) => {
    await seedVenue(db, {
      name: randomUUID(),
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
      invoiceLocales: ["es-ES"],
      operationDescription: "Restaurant",
    });
    const cfg = {};
    const departmentId = (await createDepartment(db, { name: "Dining", orderStart: "table" })).id;
    const zone = async (name: string, displayOrder: number, active = true) => {
      const z = await seedZone(db, { name, displayOrder });
      await configureZone(db, { zoneId: z!.id, departmentId });
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
async function specialDay(
  date: string,
  options: {
    repeatsYearly?: boolean;
    closedAllDay?: boolean;
    zonePaint?: { zoneId: string; ranges: ZonePaint[] }[];
  } = {},
) {
  return tx((db) =>
    saveSpecialDay(
      db,
      null,
      {
        name: `Special ${date}`,
        repeatsYearly: options.repeatsYearly ?? false,
        dates: [{ date, closedAllDay: options.closedAllDay ?? false }],
        zonePaint: (options.zonePaint ?? []).map((entry) => ({ ...entry, date })),
      },
      at,
      1,
    ),
  );
}
describe("zone closed times", () => {
  it("replaces only a zone's normal week, including clearing empty days", async () => {
    const v = await venue();
    await tx((db) => replaceZoneClosedWeek(db, v.terrace, week(), 1));
    await tx((db) =>
      replaceZoneClosedWeek(db, v.bar, week([{ startsAt: "06:00", endsAt: "06:00" }]), 1),
    );
    const day = await specialDay("2030-12-25", {
      zonePaint: [{ zoneId: v.terrace, ranges: [{ kind: "closed", ...night[0]! }] }],
    });
    await tx((db) => replaceZoneClosedWeek(db, v.terrace, week([]), 1));
    const model = await tx((db) => readOpeningHoursModel(db, at));
    const inEverySeason = <T>(week: T) =>
      model.seasons.map((season) => ({ seasonId: season.id, week }));
    expect(model.departments.find((d) => d.id === v.departmentId)!.zones).toEqual([
      {
        id: v.bar,
        name: "Bar",
        seasonWeeks: inEverySeason(week([{ startsAt: "06:00", endsAt: "06:00" }])),
      },
      {
        id: v.terrace,
        name: "Terrace",
        seasonWeeks: inEverySeason(week([])),
      },
    ]);
    expect((await tx((db) => readSpecialDay(db, day.id))).zonePaint).toEqual([
      { zoneId: v.terrace, date: "2030-12-25", ranges: [{ kind: "closed", ...night[0]! }] },
    ]);
  });
  it("refuses a switched-off department's zone without changing its rows", async () => {
    const b = await venue();
    await tx((db) => replaceZoneClosedWeek(db, b.terrace, week(), 1));
    await tx((db) => createDepartment(db, { name: "Other", orderStart: "counter" }));
    await tx((db) =>
      (async () => {
        await db.execute(
          sql`update floor_zones set active = false where id in (select id as zone_id from floor_zones where department_id = ${b.departmentId})`,
        );
        await db.execute(sql`update departments set active = false where id = ${b.departmentId}`);
      })(),
    );
    await expect(
      tx((db) => replaceZoneClosedWeek(db, b.terrace, week([]), 1)),
    ).rejects.toMatchObject({ code: "service_zone.not_found" });
    const seasonIds = await suite.db
      .select({ id: seasons.id })
      .from(seasons)

      .orderBy(seasons.id);
    expect(seasonIds).toHaveLength(4);
    expect(
      await suite.db
        .select({
          seasonId: zoneDays.seasonId,
          weekday: zoneDays.weekday,
          startsAt: zoneDayRanges.startsAt,
          endsAt: zoneDayRanges.endsAt,
        })
        .from(zoneDayRanges)
        .innerJoin(zoneDays, eq(zoneDays.id, zoneDayRanges.dayId))
        .where(eq(zoneDays.zoneId, b.terrace))
        .orderBy(zoneDays.seasonId),
    ).toEqual(
      seasonIds.map((season) => ({
        seasonId: season.id,
        weekday: 1,
        startsAt: "23:00:00",
        endsAt: "06:00:00",
      })),
    );
  });
  it("replaces a special day's zone paint on one date whole, and clears it, leaving its other date", async () => {
    const v = await venue();
    const closed = (startsAt: string, endsAt: string): ZonePaint => ({
      kind: "closed",
      startsAt,
      endsAt,
    });
    const christmas = {
      zoneId: v.terrace,
      date: "2030-12-25",
      ranges: [closed("12:00", "14:00")],
    };
    const input = (eve: ZonePaint[]) => ({
      name: "Christmas",
      repeatsYearly: false,
      dates: [
        { date: "2030-12-24", closedAllDay: false },
        { date: "2030-12-25", closedAllDay: false },
      ],
      zonePaint: [{ zoneId: v.terrace, date: "2030-12-24", ranges: eve }],
    });
    const save = (id: string | null, body: unknown) =>
      tx((db) => saveSpecialDay(db, id, body, at, 1));
    const base = input([closed("18:00", "20:00"), closed("23:00", "06:00")]);
    const first = await save(null, { ...base, zonePaint: [...base.zonePaint, christmas] });
    const replaced = await save(first.id, input([closed("21:00", "22:00")]));
    expect(replaced.zonePaint).toEqual([
      { zoneId: v.terrace, date: "2030-12-24", ranges: [closed("21:00", "22:00")] },
      christmas,
    ]);
    const cleared = await save(first.id, input([]));
    expect(cleared.zonePaint).toEqual([christmas]);
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
    await tx((db) => replaceZoneClosedWeek(db, v.terrace, week(), 1));
    await expect(tx((db) => replaceZoneClosedWeek(db, v.terrace, days, 1))).rejects.toMatchObject({
      code: "zone_closed_time.invalid",
    });
    const model = await tx((db) => readOpeningHoursModel(db, at));
    expect(
      model.departments
        .find((d) => d.id === v.departmentId)!
        .zones.find((z) => z.id === v.terrace)!
        .seasonWeeks.find(
          (entry) => entry.seasonId === (model.currentSeasonId ?? model.seasons[0]!.id),
        )!.week,
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
    await tx((db) => replaceZoneClosedWeek(db, v.terrace, week(mondayNight), 1));
    expect([...(await tx((db) => closures.closedZoneIdsAt(db, new Date(instant))))]).toEqual(
      closed ? [v.terrace] : [],
    );
  });
  it.each([
    ["2030-10-08T00:59:00Z", true],
    ["2030-10-08T01:00:00Z", false],
  ])("excludes the overnight end inside a business day at %s", async (instant, closed) => {
    const v = await venue();
    await tx((db) =>
      replaceZoneClosedWeek(db, v.terrace, week([{ startsAt: "23:30", endsAt: "03:00" }]), 1),
    );
    expect([...(await tx((db) => closures.closedZoneIdsAt(db, new Date(instant))))]).toEqual(
      closed ? [v.terrace] : [],
    );
  });
  it("uses a special day's zone paint instead of the week, an open range included", async () => {
    const v = await venue();
    await tx((db) => replaceZoneClosedWeek(db, v.terrace, week(mondayNight), 1));
    await specialDay("2030-10-07", {
      zonePaint: [
        { zoneId: v.terrace, ranges: [{ kind: "open", startsAt: "23:30", endsAt: "06:00" }] },
        { zoneId: v.bar, ranges: [{ kind: "closed", startsAt: "23:30", endsAt: "06:00" }] },
      ],
    });
    expect([
      ...(await tx((db) => closures.closedZoneIdsAt(db, new Date("2030-10-08T00:00:00Z")))),
    ]).toEqual([v.bar]);
  });
  it("keeps the week's closures on a repeating special day that paints nothing", async () => {
    const v = await venue();
    await tx((db) => replaceZoneClosedWeek(db, v.terrace, week(mondayNight), 1));
    await specialDay("2030-10-07", { repeatsYearly: true });
    expect([
      ...(await tx((db) => closures.closedZoneIdsAt(db, new Date("2041-10-07T21:45:00Z")))),
    ]).toEqual([v.terrace]);
  });
  it("closes a zone by the season of the business day", async () => {
    const v = await venue();
    const seasons = await tx((db) => ensureDefaultSeasons(db));
    const winter = seasons.find((season) => season.name === starterSeasonName("Winter", "es"))!.id;
    const friday = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      ranges: weekday === 5 ? [{ startsAt: "22:00", endsAt: "23:30" }] : [],
    }));
    await tx((db) => replaceZoneClosedWeek(db, v.terrace, friday, 1, at, { seasonId: winter }));
    const closedAt = (instant: string) =>
      tx((db) => closures.closedZoneIdsAt(db, new Date(instant)));
    // 22:30 in Madrid on Friday 29 November (Autumn) and Friday 6 December 2030 (Winter).
    expect([...(await closedAt("2030-11-29T21:30:00Z"))]).toEqual([]);
    expect([...(await closedAt("2030-12-06T21:30:00Z"))]).toEqual([v.terrace]);
  });
  it("scopes the batch to the selected zones", async () => {
    const v = await venue();
    for (const id of [v.terrace, v.bar])
      await tx((db) => replaceZoneClosedWeek(db, id, week(mondayNight), 1));
    const instant = new Date("2030-10-07T21:45:00Z");
    expect([...(await tx((db) => closures.closedZoneIdsAt(db, instant, [v.terrace])))]).toEqual([
      v.terrace,
    ]);
    expect([...(await tx((db) => closures.closedZoneIdsAt(db, instant, [])))]).toEqual([]);
  });
  it("whole-venue closure and an unreadable clock leave zone-only state open", async () => {
    const v = await venue();
    await tx((db) => replaceZoneClosedWeek(db, v.terrace, week(mondayNight), 1));
    await specialDay("2030-10-07", { closedAllDay: true });
    const instant = new Date("2030-10-07T21:45:00Z");
    expect([...(await tx((db) => closures.closedZoneIdsAt(db, instant)))]).toEqual([]);
    await tx((db) =>
      db.run(
        sql`update settings set doc = json_set(doc, '$.timeZone', ${"unreadable"}) where module = 'business_day'`,
      ),
    );
    expect([...(await tx((db) => closures.closedZoneIdsAt(db, instant)))]).toEqual([]);
  });
  it("reports closure separately from department opening and refuses only the closed zone", async () => {
    const v = await venue();
    await tx((db) => replaceZoneClosedWeek(db, v.terrace, week(mondayNight), 1));
    const instant = new Date("2030-10-07T21:45:00Z");
    const offers = await tx((db) => listZoneOffers(db, v.terrace, { at: instant }));
    const state = await tx((db) => menuState(db, v.terrace, instant));
    expect(offers.service).toMatchObject({ open: false, zoneOpen: false });
    expect(state.service).toMatchObject({ open: false, zoneOpen: false });
    await expect(
      tx((db) => VENUE_SERVICE.assertZoneTakesNewOrders(db, v.terrace, instant)),
    ).rejects.toMatchObject({ code: "service_zone.closed", params: { zoneId: v.terrace } });
    await expect(
      tx((db) => VENUE_SERVICE.assertZoneTakesNewOrders(db, v.bar, instant)),
    ).resolves.toBeUndefined();
  });
  it("reads the clock, special days and closed times once for a batch", async () => {
    const v = await venue();
    await tx((db) => replaceZoneClosedWeek(db, v.terrace, week(mondayNight), 1));
    const reads = (zoneIds: string[]) =>
      tx(async (db) => {
        const session = (
          db as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
        ).session;
        const spy = vi.spyOn(session, "prepareQuery");
        try {
          const closed = await closures.closedZoneIdsAt(
            db,
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
      for (const table of ["settings", "seasons", "special_day_dates", "zone_days", "floor_zones"])
        expect(texts.filter((text) => text.includes(`from "${table}"`))).toHaveLength(1);
      expect(texts).toHaveLength(5);
    }
    expect(three).toHaveLength(one.length);
  });
  it("reads several zones' floor closing summaries in the statements one zone takes, answering as one zone at a time does", async () => {
    const v = await venue();
    await tx((db) => replaceZoneClosedWeek(db, v.terrace, week(mondayNight), 1));
    await tx((db) =>
      replaceZoneClosedWeek(db, v.bar, week([{ startsAt: "23:45", endsAt: "02:00" }]), 1),
    );
    const instant = new Date("2030-10-07T21:40:00Z");
    const ids = [v.terrace, v.bar, v.disabled];
    const single = await tx(async (db) => {
      const answers = new Map<string, unknown>();
      for (const id of ids)
        answers.set(id, await VENUE_SERVICE.readZoneKeepOpenState(db, id, instant));
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
      counted((db) => VENUE_SERVICE.readZoneClosingStates(db, zoneIds, instant));
    const keepOpen = (states: ReadonlyMap<string, { keepOpen: unknown }>) =>
      new Map([...states].map(([id, state]) => [id, state.keepOpen]));
    const one = await batch([v.terrace]);
    const three = await batch(ids);
    expect(keepOpen(one.answers)).toEqual(new Map([[v.terrace, single.get(v.terrace)]]));
    expect(keepOpen(three.answers)).toEqual(single);
    expect(three.texts).toHaveLength(one.texts.length);
    expect((await batch([])).answers).toEqual(new Map());
    const closedOnly = await counted((db) => VENUE_SERVICE.closedZoneIdsAt(db, instant, ids));
    expect(new Map([...three.answers].map(([id, state]) => [id, state.closed]))).toEqual(
      new Map(ids.map((id) => [id, closedOnly.answers.has(id)])),
    );
    expect([...closedOnly.answers]).toEqual([v.terrace]);
    // Beyond the closed check, the summaries cost only the read of the closing zones' names.
    expect(three.texts).toHaveLength(closedOnly.texts.length + 1);
    const prepared = await counted(async (db) => {
      const day = await VENUE_SERVICE.readServiceDay(db, instant);
      const before = (
        db as unknown as { session: { prepareQuery: { mock?: { calls: unknown[] } } } }
      ).session.prepareQuery.mock!.calls.length;
      return {
        before,
        states: await VENUE_SERVICE.readZoneClosingStates(db, ids, instant, day),
      };
    });
    expect(prepared.answers.states).toEqual(three.answers);
    const afterDay = prepared.texts.slice(prepared.answers.before);
    expect(afterDay.filter((q) => /from "(settings|seasons)"/.test(q))).toEqual([]);
    expect(three.texts.filter((q) => /from "(settings|seasons)"/.test(q))).toHaveLength(2);
  });
  it("reads the day afresh when handed a day read for another business day", async () => {
    const v = await venue();
    await tx((db) => replaceZoneClosedWeek(db, v.terrace, week(), 1));
    const mondayLate = new Date("2030-10-07T21:45:00Z");
    const states = await tx(async (db) =>
      VENUE_SERVICE.readZoneClosingStates(
        db,
        [v.terrace, v.bar],
        mondayLate,
        await VENUE_SERVICE.readServiceDay(db, new Date("2030-10-08T10:00:00Z")),
      ),
    );
    expect(new Map([...states].map(([id, state]) => [id, state.closed]))).toEqual(
      new Map([
        [v.terrace, true],
        [v.bar, false],
      ]),
    );
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
