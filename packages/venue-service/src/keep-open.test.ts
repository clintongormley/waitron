import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CATALOGUE_MIGRATIONS, createCatalogue } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  floorZones,
  locations,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { configureZone, createDepartment } from "./operations.js";
import {
  replaceMenuWeek,
  resolveDepartmentService,
  saveMenuPeriod,
  updateMenuPeriod,
} from "./menu-timetable.js";
import { localTimeOccurrences } from "./hours-occurrences.js";
import { periodExtensions } from "./schema/period-extensions.js";
import { specialDates } from "./schema/hours.js";
import { VENUE_SERVICE } from "./service.js";
import { keepPeriodOpen, readKeepOpen } from "./keep-open.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
const at = (time: string, date = "2026-10-09") =>
  new Date(localTimeOccurrences(date, time, "Europe/Madrid")[0]!);
async function fixture(options: { afternoon?: boolean; spring?: boolean } = {}) {
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
      await createDepartment(tx, cfg, { name: "Restaurant", defaultServiceMode: "table_tab" })
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
        slots: [
          {
            periodId: lunch,
            startsAt: options.spring ? "21:00" : "12:00",
            endsAt: options.spring ? "01:00" : "14:00",
          },
          ...(options.afternoon
            ? [{ periodId: afternoon, startsAt: "14:00", endsAt: "19:00" }]
            : []),
        ],
      })),
      at("12:00"),
    );
    return { cfg, departmentId, zoneId: zone!.id, lunch, afternoon, menuId: menu.id };
  });
}
const rows = (f: Awaited<ReturnType<typeof fixture>>) =>
  suite.db.select().from(periodExtensions).where(eq(periodExtensions.departmentId, f.departmentId));

describe("keeping a period open today", () => {
  it("writes and replaces one extension without moving its scheduled start", async () => {
    const f = await fixture();
    await run((tx) =>
      keepPeriodOpen(tx, f.cfg, f.zoneId, { periodId: f.lunch, until: "14:30" }, at("13:50")),
    );
    const original = await rows(f);
    expect(original).toEqual([
      {
        id: expect.any(String),
        departmentId: f.departmentId,
        businessDay: "2026-10-09",
        periodId: f.lunch,
        startsAt: "14:00:00",
        endsAt: "14:30:00",
      },
    ]);
    await run((tx) =>
      keepPeriodOpen(tx, f.cfg, f.zoneId, { periodId: f.lunch, until: "15:00" }, at("14:20")),
    );
    expect(await rows(f)).toEqual([{ ...original[0], endsAt: "15:00:00" }]);
    expect(
      (await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, at("14:20")))).period,
    ).toMatchObject({ id: f.lunch, endsAt: "15:00", extendedUntil: "15:00", running: true });
  });
  it("offers future quarter hours through the changeover and describes the next period", async () => {
    const f = await fixture({ afternoon: true });
    const result = await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, at("13:50")));
    const choices = Array.from({ length: 64 }, (_, i) => {
      const minute = (14 * 60 + 15 + i * 15) % 1440;
      return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    });
    expect(result).toEqual({
      period: {
        id: f.lunch,
        name: "Lunch",
        endsAt: "14:00",
        running: true,
        extendedUntil: null,
        dayEndsAt: "06:00",
        choices,
        next: { name: "Afternoon", startsAt: "14:00", endsAt: "19:00" },
      },
    });
  });
  it.each([
    ["14:10", "step"],
    ["13:45", "not_later"],
    ["14:00", "not_later"],
    ["24:00", "step"],
    ["bad", "step"],
  ])("refuses %s and retains the previous row", async (until, reason) => {
    const f = await fixture();
    await run((tx) =>
      keepPeriodOpen(tx, f.cfg, f.zoneId, { periodId: f.lunch, until: "14:30" }, at("13:50")),
    );
    const before = await rows(f);
    await expect(
      run((tx) => keepPeriodOpen(tx, f.cfg, f.zoneId, { periodId: f.lunch, until }, at("13:50"))),
    ).rejects.toMatchObject({
      code: "period_extension.invalid",
      params: { field: "until", reason },
    });
    expect(await rows(f)).toEqual(before);
  });
  it("refuses another period, including one from a different department", async () => {
    const f = await fixture();
    const other = await fixture();
    for (const periodId of [f.afternoon, other.lunch])
      await expect(
        run((tx) => keepPeriodOpen(tx, f.cfg, f.zoneId, { periodId, until: "16:00" }, at("13:50"))),
      ).rejects.toMatchObject({ code: "period_extension.not_allowed" });
    expect(await rows(f)).toEqual([]);
  });
  it("reopens the last ended period when no period runs", async () => {
    const f = await fixture();
    await run((tx) =>
      keepPeriodOpen(tx, f.cfg, f.zoneId, { periodId: f.lunch, until: "16:00" }, at("15:10")),
    );
    expect(await rows(f)).toMatchObject([{ startsAt: "14:00:00", endsAt: "16:00:00" }]);
    const read = await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, at("15:10")));
    expect(read.period).toMatchObject({ id: f.lunch, running: true });
    expect(read.period!.choices[0]).toBe("15:15");
  });
  it("deletes the day's extension and cleans old rows only in this department", async () => {
    const f = await fixture();
    const other = await fixture();
    await run(async (tx) => {
      await tx.insert(periodExtensions).values([
        {
          departmentId: f.departmentId,
          businessDay: "2026-10-08",
          periodId: f.lunch,
          startsAt: "14:00:00",
          endsAt: "15:00:00",
        },
        {
          departmentId: other.departmentId,
          businessDay: "2026-10-08",
          periodId: other.lunch,
          startsAt: "14:00:00",
          endsAt: "15:00:00",
        },
      ]);
      await keepPeriodOpen(tx, f.cfg, f.zoneId, { periodId: f.lunch, until: "14:30" }, at("13:50"));
    });
    expect((await rows(f)).map((row) => row.businessDay)).toEqual(["2026-10-09"]);
    await run((tx) =>
      keepPeriodOpen(tx, f.cfg, f.zoneId, { periodId: f.lunch, until: null }, at("13:50")),
    );
    expect(await rows(f)).toEqual([]);
    expect(await rows(other)).toHaveLength(1);
  });
  it("offers nothing before the first run or on a whole-venue closure, even with a stored extension", async () => {
    const f = await fixture();
    expect(await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, at("11:00")))).toEqual({
      period: null,
    });
    await run(async (tx) => {
      await keepPeriodOpen(tx, f.cfg, f.zoneId, { periodId: f.lunch, until: "16:00" }, at("13:50"));
      await tx.insert(specialDates).values({
        ...f.cfg,
        date: "2026-10-09",
        name: "Closed",
        closeWholeVenue: true,
      });
    });
    expect(await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, at("14:20")))).toEqual({
      period: null,
    });
    await expect(
      run((tx) =>
        keepPeriodOpen(tx, f.cfg, f.zoneId, { periodId: f.lunch, until: "17:00" }, at("14:20")),
      ),
    ).rejects.toMatchObject({ code: "period_extension.not_allowed" });
  });
  it("excludes skipped clock times and refuses one as an extension end", async () => {
    const f = await fixture({ spring: true });
    const now = at("23:00", "2027-03-27");
    const read = await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, now));
    expect(read.period!.choices).toContain("01:45");
    expect(read.period!.choices).not.toContain("02:00");
    expect(read.period!.choices).not.toContain("02:30");
    expect(read.period!.choices).toContain("03:00");
    expect(read.period!.choices.at(-1)).toBe("06:00");
    await expect(
      run((tx) => keepPeriodOpen(tx, f.cfg, f.zoneId, { periodId: f.lunch, until: "02:30" }, now)),
    ).rejects.toMatchObject({
      code: "period_extension.invalid",
      params: { field: "until", reason: "clock_skips" },
    });
    expect(await rows(f)).toEqual([]);
  });
  it("refuses an unreadable clock and a zone outside this venue", async () => {
    const f = await fixture();
    const other = await fixture();
    await expect(
      run((tx) => readKeepOpen(tx, f.cfg, other.zoneId, at("13:50"))),
    ).rejects.toMatchObject({ code: "service_zone.not_found" });
    await suite.db
      .update(locations)
      .set({ timeZone: "Not/AZone" })
      .where(eq(locations.id, f.cfg.locationId));
    expect(await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, at("13:50")))).toEqual({
      period: null,
    });
    for (const until of ["16:00", null])
      await expect(
        run((tx) => keepPeriodOpen(tx, f.cfg, f.zoneId, { periodId: f.lunch, until }, at("13:50"))),
      ).rejects.toMatchObject({ code: "time_zone.unreadable" });
  });
});

it("exposes the writer and read through the generic service contract", async () => {
  const f = await fixture();
  await run((tx) =>
    VENUE_SERVICE.keepPeriodOpen(
      tx,
      f.cfg,
      f.zoneId,
      { periodId: f.lunch, until: "14:30" },
      at("13:50"),
    ),
  );
  expect(
    (await run((tx) => VENUE_SERVICE.readKeepOpen(tx, f.cfg, f.zoneId, at("14:20")))).period,
  ).toMatchObject({ id: f.lunch, endsAt: "14:30", extendedUntil: "14:30", running: true });
});

it("permits shortening an extension above its scheduled end, but never into the past", async () => {
  const f = await fixture();
  await run((tx) =>
    keepPeriodOpen(tx, f.cfg, f.zoneId, { periodId: f.lunch, until: "15:00" }, at("13:50")),
  );
  await run((tx) =>
    keepPeriodOpen(tx, f.cfg, f.zoneId, { periodId: f.lunch, until: "14:30" }, at("14:20")),
  );
  const before = await rows(f);
  await expect(
    run((tx) =>
      keepPeriodOpen(tx, f.cfg, f.zoneId, { periodId: f.lunch, until: "14:15" }, at("14:20")),
    ),
  ).rejects.toMatchObject({
    code: "period_extension.invalid",
    params: { field: "until", reason: "not_later" },
  });
  expect(await rows(f)).toEqual(before);
});

it.each([
  { offset: -15, time: "13:50", orderable: true, sendable: true },
  { offset: -15, time: "14:44", orderable: true, sendable: true },
  { offset: -15, time: "14:45", orderable: false, sendable: false },
  { offset: 15, time: "15:00", orderable: false, sendable: true },
  { offset: 15, time: "15:15", orderable: false, sendable: false },
])(
  "measures offset $offset at $time from the extended end",
  async ({ offset, time, orderable, sendable }) => {
    const f = await fixture();
    await run((tx) => updateMenuPeriod(tx, f.cfg, f.lunch, { endOffsetMinutes: offset }));
    await run((tx) =>
      keepPeriodOpen(tx, f.cfg, f.zoneId, { periodId: f.lunch, until: "15:00" }, at("13:00")),
    );
    const state = await run((tx) => resolveDepartmentService(tx, f.cfg, f.departmentId, at(time)));
    expect(state.orderableMenuIds).toEqual(orderable ? [f.menuId] : []);
    expect(state.sendableMenuIds).toEqual(sendable ? [f.menuId] : []);
  },
);

it.each([
  ["05:50:00", "05:45"],
  ["05:05:00", "05:00"],
])("offers clock quarters accepted by the writer for a %s changeover", async (cutover, last) => {
  const f = await fixture();
  await run(async (tx) => {
    await tx
      .update(locations)
      .set({ dayCutover: cutover })
      .where(eq(locations.id, f.cfg.locationId));
  });
  const result = await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, at("13:50")));
  expect(result.period!.choices[0]).toBe("14:15");
  expect(result.period!.choices.at(-1)).toBe(last);
  expect(result.period!.choices.every((time) => /:(00|15|30|45)$/.test(time))).toBe(true);
  for (const until of [result.period!.choices[0]!, result.period!.choices.at(-1)!]) {
    await run((tx) =>
      keepPeriodOpen(tx, f.cfg, f.zoneId, { periodId: f.lunch, until }, at("13:50")),
    );
    expect(await rows(f)).toMatchObject([{ endsAt: `${until}:00` }]);
  }
});

it("reports the real non-quarter service-day endpoint", async () => {
  const f = await fixture();
  await run((tx) =>
    tx.update(locations).set({ dayCutover: "05:50:00" }).where(eq(locations.id, f.cfg.locationId)),
  );
  const result = await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, at("13:50")));
  expect(result.period).toMatchObject({ dayEndsAt: "05:50" });
  expect(result.period!.choices.at(-1)).toBe("05:45");
});
it.each([
  ["15:00", "19:00"],
  ["15:15", "15:00"],
])(
  "reports the next period's contiguous end when the second run starts at %s",
  async (secondStart, expectedEnd) => {
    const f = await fixture({ afternoon: true });
    await run((tx) =>
      replaceMenuWeek(
        tx,
        f.cfg,
        f.departmentId,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: [
            { periodId: f.lunch, startsAt: "12:00", endsAt: "14:00" },
            { periodId: f.afternoon, startsAt: "14:00", endsAt: "15:00" },
            { periodId: f.afternoon, startsAt: secondStart, endsAt: "19:00" },
          ],
        })),
        at("12:00"),
      ),
    );
    expect(
      (await run((tx) => readKeepOpen(tx, f.cfg, f.zoneId, at("13:50")))).period!.next,
    ).toEqual({ name: "Afternoon", startsAt: "14:00", endsAt: expectedEnd });
  },
);
