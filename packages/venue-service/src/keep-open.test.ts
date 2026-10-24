import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { CATALOGUE_MIGRATIONS, createCatalogue } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  locationDayCutoverChanges,
  floorZones,
  locations,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { configureZone, createDepartment, listZoneOffers, menuState } from "./operations.js";
import { replaceMenuWeek, saveMenuPeriod } from "./menu-timetable.js";
import { localTimeOccurrences } from "./hours-occurrences.js";
import { periodExtensions } from "./schema/period-extensions.js";
import { specialDayDates, specialDays } from "./schema/seasons.js";
import { VENUE_SERVICE } from "./service.js";
import * as keep from "./keep-open.js";
import { zoneExtensions } from "./schema/zone-extensions.js";
import { closedZoneIdsAt, replaceZoneClosedWeek } from "./zone-closed-times.js";
import { readKeepOpen } from "./keep-open.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
const at = (time: string, date = "2026-10-09") =>
  new Date(localTimeOccurrences(date, time, "Europe/Madrid")[0]!);
async function fixture() {
  return run(async (tx) => {
    const [venue] = await tx
      .insert(locations)
      .values({
        name: "Venue",
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
        timeZone: "Europe/Madrid",
        dayCutover: "06:00:00",
      })
      .returning();
    const cfg = { locationId: locationId(venue!.id) };
    const departmentId = (
      await createDepartment(tx, cfg, { name: "Restaurant", orderStart: "table" })
    ).id;
    const [zone] = await tx
      .insert(floorZones)
      .values({ ...cfg, name: "Dining" })
      .returning();
    await configureZone(tx, cfg, { zoneId: zone!.id, departmentId });
    const menu = await createCatalogue(tx, { name: "Menu" });
    const lunch = (
      await saveMenuPeriod(tx, cfg, departmentId, {
        name: "Lunch",
        menuId: menu.id,
        staffMenuIds: [],
      })
    ).id;
    const afternoon = (
      await saveMenuPeriod(tx, cfg, departmentId, {
        name: "Afternoon",
        menuId: menu.id,
        staffMenuIds: [],
      })
    ).id;
    await replaceMenuWeek(
      tx,
      cfg,
      departmentId,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [{ periodId: lunch, startsAt: "12:00", endsAt: "14:00" }],
      })),
      at("12:00"),
      0,
    );
    return { cfg, departmentId, zoneId: zone!.id, lunch, afternoon, menuId: menu.id };
  });
}
async function zoneFixture(endsAt = "03:00") {
  const f = await fixture();
  await run(async (tx) => {
    await replaceMenuWeek(
      tx,
      f.cfg,
      f.departmentId,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [{ periodId: f.lunch, startsAt: "21:00", endsAt }],
      })),
      at("21:00"),
      0,
    );
    await replaceZoneClosedWeek(
      tx,
      f.cfg,
      f.zoneId,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        ranges: [{ startsAt: "23:30", endsAt: "06:00" }],
      })),
      0,
    );
  });
  return f;
}
const zoneRows = (f: Awaited<ReturnType<typeof fixture>>) =>
  suite.db.select().from(zoneExtensions).where(eq(zoneExtensions.zoneId, f.zoneId));

describe("keeping a zone open today", () => {
  it("writes and replaces today's extension with the original closing time", async () => {
    const f = await zoneFixture();
    await run((tx) => keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "01:30" }, at("23:00")));
    const original = await zoneRows(f);
    expect(original).toEqual([
      {
        id: expect.any(String),
        zoneId: f.zoneId,
        businessDay: "2026-10-09",
        startsAt: "23:30:00",
        endsAt: "01:30:00",
      },
    ]);
    await run((tx) =>
      keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "02:00" }, at("01:00", "2026-10-10")),
    );
    expect(await zoneRows(f)).toEqual([{ ...original[0], endsAt: "02:00:00" }]);
    expect(
      (await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, at("01:00", "2026-10-10")))).zone,
    ).toMatchObject({
      id: f.zoneId,
      name: "Dining",
      endsAt: "02:00",
      running: true,
      extendedUntil: "02:00",
      dayEndsAt: "06:00",
    });
  });
  it.each([
    ["23:29", "2026-10-09", false],
    ["23:30", "2026-10-09", false],
    ["01:00", "2026-10-10", false],
    ["01:30", "2026-10-10", true],
    ["06:00", "2026-10-10", false],
  ])("carves a half-open extension at %s", async (time, date, closed) => {
    const f = await zoneFixture();
    await run((tx) =>
      tx.insert(zoneExtensions).values({
        zoneId: f.zoneId,
        businessDay: "2026-10-09",
        startsAt: "23:30:00",
        endsAt: "01:30:00",
      }),
    );
    expect([
      ...(await run((tx) => closedZoneIdsAt(tx, f.cfg, at(time, date), [f.zoneId]))),
    ]).toEqual(closed ? [f.zoneId] : []);
  });
  it("the keep-open read names only the zone", async () => {
    const f = await zoneFixture();
    expect(Object.keys(await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, at("23:00"))))).toEqual([
      "zone",
    ]);
  });
  it("offers only choices for which the department stays open continuously", async () => {
    const f = await zoneFixture("01:00");
    const read = await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, at("23:00")));
    expect(read.zone).toEqual({
      id: f.zoneId,
      name: "Dining",
      endsAt: "23:30",
      running: true,
      extendedUntil: null,
      dayEndsAt: "06:00",
      choices: ["23:45", "00:00", "00:15", "00:30", "00:45", "01:00"],
    });
    await expect(
      run((tx) => keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "01:30" }, at("23:00"))),
    ).rejects.toMatchObject({
      code: "zone_extension.not_allowed",
      params: { zoneId: f.zoneId, reason: "department_closed" },
    });
    expect(await zoneRows(f)).toEqual([]);
  });
  it("refuses a gap in department hours even if the requested end is in a running period", async () => {
    const f = await zoneFixture();
    await run((tx) =>
      replaceMenuWeek(
        tx,
        f.cfg,
        f.departmentId,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: [
            { periodId: f.lunch, startsAt: "21:00", endsAt: "00:00" },
            { periodId: f.afternoon, startsAt: "00:15", endsAt: "03:00" },
          ],
        })),
        at("21:00"),
        0,
      ),
    );
    await expect(
      run((tx) => keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "01:30" }, at("23:00"))),
    ).rejects.toMatchObject({
      code: "zone_extension.not_allowed",
      params: { reason: "department_closed" },
    });
    expect(
      (await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, at("23:00")))).zone!.choices,
    ).toEqual(["23:45", "00:00"]);
  });
  it("a stored period extension no longer lets a zone stay open past its department's own end", async () => {
    const f = await zoneFixture("01:00");
    await run((tx) =>
      tx.insert(periodExtensions).values({
        departmentId: f.departmentId,
        businessDay: "2026-10-09",
        periodId: f.lunch,
        startsAt: "01:00:00",
        endsAt: "02:00:00",
      }),
    );
    const instant = at("00:30", "2026-10-10");
    expect(
      (await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, instant))).zone!.choices.at(-1),
    ).toBe("01:00");
    await expect(
      run((tx) => keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "01:30" }, instant)),
    ).rejects.toMatchObject({
      code: "zone_extension.not_allowed",
      params: { reason: "department_closed" },
    });
    expect(await zoneRows(f)).toEqual([]);
  });
  it("can reopen a zone already closed", async () => {
    const f = await zoneFixture("02:00");
    await run((tx) =>
      keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "01:30" }, at("00:30", "2026-10-10")),
    );
    expect([
      ...(await run((tx) => closedZoneIdsAt(tx, f.cfg, at("01:00", "2026-10-10"), [f.zoneId]))),
    ]).toEqual([]);
  });
  it("refuses when the department is closed now", async () => {
    const f = await zoneFixture("01:00");
    await expect(
      run((tx) =>
        keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "02:00" }, at("01:15", "2026-10-10")),
      ),
    ).rejects.toMatchObject({
      code: "zone_extension.not_allowed",
      params: { reason: "department_closed" },
    });
  });
  it("offers nothing and refuses when no closed time remains today", async () => {
    const f = await zoneFixture();
    await run((tx) =>
      replaceZoneClosedWeek(
        tx,
        f.cfg,
        f.zoneId,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: [] })),
        0,
      ),
    );
    expect((await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, at("23:00")))).zone).toBeNull();
    await expect(
      run((tx) => keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "01:30" }, at("23:00"))),
    ).rejects.toMatchObject({
      code: "zone_extension.not_allowed",
      params: { reason: "not_closing" },
    });
  });
  it.each([
    ["23:40", "step"],
    ["23:30", "not_later"],
    ["23:15", "not_later"],
    ["24:00", "step"],
    ["bad", "step"],
  ])("refuses invalid until %s without replacing the row", async (until, reason) => {
    const f = await zoneFixture();
    await run((tx) => keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "01:30" }, at("23:00")));
    const before = await zoneRows(f);
    await expect(
      run((tx) => keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until }, at("23:00"))),
    ).rejects.toMatchObject({ code: "zone_extension.invalid", params: { field: "until", reason } });
    expect(await zoneRows(f)).toEqual(before);
  });
  it("removes today's row and cleans old rows only for this zone", async () => {
    const f = await zoneFixture(),
      other = await zoneFixture();
    await run(async (tx) => {
      await tx.insert(zoneExtensions).values(
        [f, other].map((v) => ({
          zoneId: v.zoneId,
          businessDay: "2026-10-08",
          startsAt: "23:30:00",
          endsAt: "01:30:00",
        })),
      );
      await keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "01:30" }, at("23:00"));
    });
    expect((await zoneRows(f)).map((r) => r.businessDay)).toEqual(["2026-10-09"]);
    await run((tx) => keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: null }, at("23:00")));
    expect(await zoneRows(f)).toEqual([]);
    expect(await zoneRows(other)).toHaveLength(1);
    expect([
      ...(await run((tx) => closedZoneIdsAt(tx, f.cfg, at("01:00", "2026-10-10"), [f.zoneId]))),
    ]).toEqual([f.zoneId]);
  });
  it("publishes zone state without reading extensions on the pricing path", async () => {
    const f = await zoneFixture();
    expect(
      (await run((tx) => menuState(tx, f.cfg, f.zoneId, at("23:00")))).service.zoneKeepOpen,
    ).toEqual({
      zoneId: f.zoneId,
      zoneName: "Dining",
      closesAt: "23:30",
      running: true,
      extendedUntil: null,
    });
    await run(async (tx) => {
      const session = (
        tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
      ).session;
      const spy = vi.spyOn(session, "prepareQuery");
      try {
        const offers = await listZoneOffers(tx, f.cfg, f.zoneId, {
          withDefault: false,
          at: at("23:00"),
        });
        expect(offers.service.zoneKeepOpen).toBeNull();
        const sql = spy.mock.calls.map(([q]) => (q as unknown as { sql: string }).sql);
        expect(sql.some((q) => q.includes('"zone_extensions"'))).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });
  });
});

it("keeps removal available after the department closes and refuses a foreign zone", async () => {
  const f = await zoneFixture("01:00"),
    other = await zoneFixture();
  await run((tx) =>
    VENUE_SERVICE.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "00:30" }, at("23:00")),
  );
  await run((tx) =>
    keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: null }, at("01:15", "2026-10-10")),
  );
  expect(await zoneRows(f)).toEqual([]);
  await expect(
    run((tx) => keep.keepZoneOpen(tx, f.cfg, other.zoneId, { until: "01:30" }, at("23:00"))),
  ).rejects.toMatchObject({ code: "service_zone.not_found" });
  await run((tx) =>
    tx.update(locations).set({ timeZone: "Not/AZone" }).where(eq(locations.id, f.cfg.locationId)),
  );
  await expect(
    run((tx) => keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "01:30" }, at("23:00"))),
  ).rejects.toMatchObject({ code: "time_zone.unreadable" });
});
it("excludes a skipped zone end from choices and refuses it without writing", async () => {
  const f = await zoneFixture("06:00");
  const now = at("23:00", "2027-03-27");
  const read = await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, now));
  expect(read.zone!.choices).toContain("01:45");
  expect(read.zone!.choices).not.toContain("02:00");
  expect(read.zone!.choices).not.toContain("02:30");
  expect(read.zone!.choices).toContain("03:00");
  expect(read.zone!.choices.at(-1)).toBe("06:00");
  await expect(
    run((tx) => keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "02:30" }, now)),
  ).rejects.toMatchObject({
    code: "zone_extension.invalid",
    params: { field: "until", reason: "clock_skips" },
  });
  expect(await zoneRows(f)).toEqual([]);
});

it("retains a spanning extension in both readouts and when replacing it after the first closure", async () => {
  const f = await fixture();
  await run(async (tx) => {
    await replaceMenuWeek(
      tx,
      f.cfg,
      f.departmentId,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [{ periodId: f.lunch, startsAt: "21:00", endsAt: "06:00" }],
      })),
      at("21:00"),
      0,
    );
    await replaceZoneClosedWeek(
      tx,
      f.cfg,
      f.zoneId,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        ranges: [
          { startsAt: "23:30", endsAt: "00:30" },
          { startsAt: "01:00", endsAt: "03:00" },
        ],
      })),
      0,
    );
    await keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "02:00" }, at("23:00"));
  });
  for (const time of ["00:45", "01:30"]) {
    const instant = at(time, "2026-10-10");
    expect((await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, instant))).zone).toMatchObject({
      endsAt: "02:00",
      extendedUntil: "02:00",
      running: true,
    });
    expect(
      (await run((tx) => menuState(tx, f.cfg, f.zoneId, instant))).service.zoneKeepOpen,
    ).toMatchObject({ closesAt: "02:00", extendedUntil: "02:00", running: true });
    expect((await run((tx) => closedZoneIdsAt(tx, f.cfg, instant, [f.zoneId]))).has(f.zoneId)).toBe(
      false,
    );
  }
  await run((tx) =>
    keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "02:30" }, at("01:30", "2026-10-10")),
  );
  expect(await zoneRows(f)).toEqual([
    {
      id: expect.any(String),
      zoneId: f.zoneId,
      businessDay: "2026-10-09",
      startsAt: "23:30:00",
      endsAt: "02:30:00",
    },
  ]);
  expect(
    (await run((tx) => closedZoneIdsAt(tx, f.cfg, at("02:30", "2026-10-10"), [f.zoneId]))).has(
      f.zoneId,
    ),
  ).toBe(true);
});

it("shows the effective extension after a manager moves the closure start", async () => {
  const f = await zoneFixture();
  await run((tx) => keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "01:30" }, at("23:00")));
  await run((tx) =>
    replaceZoneClosedWeek(
      tx,
      f.cfg,
      f.zoneId,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        ranges: [{ startsAt: "23:00", endsAt: "06:00" }],
      })),
      0,
    ),
  );
  const instant = at("23:45");
  expect((await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, instant))).zone).toMatchObject({
    endsAt: "01:30",
    extendedUntil: "01:30",
    running: true,
  });
  expect(
    (await run((tx) => menuState(tx, f.cfg, f.zoneId, instant))).service.zoneKeepOpen,
  ).toMatchObject({ closesAt: "01:30", extendedUntil: "01:30", running: true });
});

it("reads the clock, the seasons and the special days once for a zone's keep-open choices", async () => {
  const f = await zoneFixture();
  await run(async (tx) => {
    const session = (tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } })
      .session;
    const spy = vi.spyOn(session, "prepareQuery");
    try {
      const zone = await keep.readZoneKeepOpen(tx, f.cfg, f.zoneId, at("23:00"));
      expect(zone).toMatchObject({ endsAt: "23:30", running: true });
      const sql = spy.mock.calls.map(([q]) => (q as unknown as { sql: string }).sql);
      expect(sql.filter((q) => q.includes('from "seasons"'))).toHaveLength(1);
      expect(sql.filter((q) => q.includes('from "special_day_dates"'))).toHaveLength(1);
      expect(sql.filter((q) => q.includes('from "locations"'))).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});

it("reads a floor closing summary without building period choices", async () => {
  const f = await zoneFixture();
  await run(async (tx) => {
    const session = (tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } })
      .session;
    const spy = vi.spyOn(session, "prepareQuery");
    try {
      const answer = await VENUE_SERVICE.readZoneKeepOpenState(tx, f.cfg, f.zoneId, at("23:00"));
      expect(answer).toEqual({
        zoneId: f.zoneId,
        zoneName: "Dining",
        closesAt: "23:30",
        running: true,
        extendedUntil: null,
      });
      const sql = spy.mock.calls.map(([q]) => (q as unknown as { sql: string }).sql);
      expect(
        sql.some((q) => q.includes('"menu_periods"') || q.includes('"period_extensions"')),
      ).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

it.each([
  ["23:30", "00:30"],
  ["03:00", "04:00"],
])(
  "leaves a disjoint saved extension %s–%s out of the next closure readout",
  async (startsAt, endsAt) => {
    const f = await fixture();
    await run(async (tx) => {
      await replaceZoneClosedWeek(
        tx,
        f.cfg,
        f.zoneId,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          ranges: [{ startsAt: "01:00", endsAt: "03:00" }],
        })),
        0,
      );
      await tx
        .insert(zoneExtensions)
        .values({ zoneId: f.zoneId, businessDay: "2026-10-09", startsAt, endsAt });
    });
    const instant = at("01:30", "2026-10-10");
    expect((await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, instant))).zone).toMatchObject({
      endsAt: "01:00",
      extendedUntil: null,
      running: false,
    });
    expect(
      await run((tx) => VENUE_SERVICE.readZoneKeepOpenState(tx, f.cfg, f.zoneId, instant)),
    ).toMatchObject({ closesAt: "01:00", extendedUntil: null, running: false });
  },
);

it("a zone offers nothing and refuses on a whole-venue closed day", async () => {
  const f = await zoneFixture();
  await run(async (tx) => {
    await keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "01:30" }, at("23:00"));
    const [day] = await tx
      .insert(specialDays)
      .values({ ...f.cfg, name: "Closed" })
      .returning({ id: specialDays.id });
    await tx
      .insert(specialDayDates)
      .values({ ...f.cfg, specialDayId: day!.id, date: "2026-10-09", closedAllDay: true });
  });
  const before = await zoneRows(f);
  expect(await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, at("23:15")))).toEqual({
    zone: null,
  });
  await expect(
    run((tx) => keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "02:00" }, at("23:15"))),
  ).rejects.toMatchObject({ code: "zone_extension.not_allowed" });
  expect(await zoneRows(f)).toEqual(before);
});

it("the zone read answers nothing for an unreadable clock and refuses a foreign zone", async () => {
  const f = await zoneFixture();
  const other = await zoneFixture();
  await expect(
    run((tx) => readKeepOpen(tx, f.cfg, other.zoneId, at("23:00"))),
  ).rejects.toMatchObject({ code: "service_zone.not_found" });
  await suite.db
    .update(locations)
    .set({ timeZone: "Not/AZone" })
    .where(eq(locations.id, f.cfg.locationId));
  expect(await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, at("23:00")))).toEqual({
    zone: null,
  });
});

it("exposes the zone writer and read through the generic service contract", async () => {
  const f = await zoneFixture();
  await run((tx) =>
    VENUE_SERVICE.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "01:30" }, at("23:00")),
  );
  expect(
    (await run((tx) => VENUE_SERVICE.readKeepOpen(tx, f.cfg, f.zoneId, at("00:30", "2026-10-10"))))
      .zone,
  ).toMatchObject({ endsAt: "01:30", extendedUntil: "01:30", running: true });
});

it("permits shortening a zone extension, but never into the past", async () => {
  const f = await zoneFixture();
  await run((tx) => keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "02:00" }, at("23:00")));
  await run((tx) =>
    keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "01:30" }, at("01:00", "2026-10-10")),
  );
  const before = await zoneRows(f);
  expect(before).toMatchObject([{ endsAt: "01:30:00" }]);
  await expect(
    run((tx) =>
      keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: "00:45" }, at("01:00", "2026-10-10")),
    ),
  ).rejects.toMatchObject({
    code: "zone_extension.invalid",
    params: { field: "until", reason: "not_later" },
  });
  expect(await zoneRows(f)).toEqual(before);
});

it.each([
  ["05:50:00", "05:45", "05:50"],
  ["05:05:00", "05:00", "05:05"],
])(
  "offers a zone clock quarters accepted by the writer for a %s changeover",
  async (cutover, end, dayEndsAt) => {
    const f = await fixture();
    await run(async (tx) => {
      await tx
        .update(locations)
        .set({ dayCutover: cutover })
        .where(eq(locations.id, f.cfg.locationId));
      await replaceMenuWeek(
        tx,
        f.cfg,
        f.departmentId,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: [{ periodId: f.lunch, startsAt: "21:00", endsAt: end }],
        })),
        at("21:00"),
        0,
      );
      await replaceZoneClosedWeek(
        tx,
        f.cfg,
        f.zoneId,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          ranges: [{ startsAt: "23:30", endsAt: end }],
        })),
        0,
      );
    });
    const zone = await run((tx) => keep.readZoneKeepOpen(tx, f.cfg, f.zoneId, at("23:00")));
    expect(zone).toMatchObject({ dayEndsAt });
    expect(zone!.choices[0]).toBe("23:45");
    expect(zone!.choices.at(-1)).toBe(end);
    expect(zone!.choices.every((time) => /:(00|15|30|45)$/.test(time))).toBe(true);
    for (const until of [zone!.choices[0]!, zone!.choices.at(-1)!]) {
      await run((tx) => keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until }, at("23:00")));
      expect(await zoneRows(f)).toMatchObject([{ endsAt: `${until}:00` }]);
    }
  },
);

describe("zone extensions use the actual following boundary", () => {
  it.each([
    ["04:00", "04:00", "04:15"],
    ["08:00", "06:00", "06:15"],
  ])("bounds a zone's choices before a %s start", async (cutover, lastChoice, refusedUntil) => {
    const f = await zoneFixture("06:00");
    await run((tx) =>
      tx.insert(locationDayCutoverChanges).values({
        locationId: f.cfg.locationId,
        effectiveBusinessDay: "2026-11-04",
        dayCutover: `${cutover}:00`,
      }),
    );
    const now = at("23:00", "2026-11-03");
    const zone = await run((tx) => keep.readZoneKeepOpen(tx, f.cfg, f.zoneId, now));
    expect(zone!.choices.at(-1)).toBe(lastChoice);
    expect(zone!.dayEndsAt).toBe(cutover);
    await expect(
      run((tx) => keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: refusedUntil }, now)),
    ).rejects.toMatchObject({
      code: "zone_extension.invalid",
      params: { field: "until", reason: "not_later" },
    });
    await expect(
      run((tx) => keep.keepZoneOpen(tx, f.cfg, f.zoneId, { until: null }, now)),
    ).resolves.toBeUndefined();
  });
});
