import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  buildMenuDocument,
  createCatalogue,
  menuDocumentHash,
  publishMenu,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  floorZones,
  locations,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { replaceMenuWeek, saveMenuPeriod } from "./menu-timetable.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { configureZone, createDepartment, type VenueScope } from "./operations.js";
import { specialDates } from "./schema/hours.js";
import { departmentDays, specialDayDates, specialDays, zoneDays } from "./schema/seasons.js";
import {
  deleteSpecialDay,
  readSpecialDay,
  saveSpecialDay,
  type SpecialDayDetail,
} from "./special-days.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});
const scoped = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(db, fn);
const AT = new Date("2030-10-07T10:00:00Z");

async function venue() {
  const [location] = await db
    .insert(locations)
    .values({
      name: `Casa ${randomUUID()}`,
      invoiceLocales: ["es-ES"],
      operationDescription: "Hostelería",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
    })
    .returning({ id: locations.id });
  const cfg: VenueScope = { locationId: brandLocationId(location!.id) };
  const [zone] = await db
    .insert(floorZones)
    .values({ locationId: cfg.locationId, name: "Sala", displayOrder: 0 })
    .returning({ id: floorZones.id });
  return scoped(async (tx) => {
    const restaurant = (
      await createDepartment(tx, cfg, { name: "Restaurant", orderStart: "table" })
    ).id;
    const bar = (await createDepartment(tx, cfg, { name: "Bar", orderStart: "counter" })).id;
    await configureZone(tx, cfg, { zoneId: zone!.id, departmentId: restaurant });
    const period = async (departmentId: string, name: string) => {
      const menuId = (await createCatalogue(tx, { name })).id;
      const { document } = await buildMenuDocument(tx, menuId);
      await publishMenu(tx, menuId, menuDocumentHash(document), "person-1");
      return (await saveMenuPeriod(tx, cfg, departmentId, { name, menuId, staffMenuIds: [] }, 0))
        .id;
    };
    return {
      cfg,
      restaurant,
      bar,
      sala: zone!.id,
      lunch: await period(restaurant, "Lunch"),
      dinner: await period(restaurant, "Dinner"),
      drinks: await period(bar, "Drinks"),
    };
  });
}
type Venue = Awaited<ReturnType<typeof venue>>;

const save = (v: Venue, id: string | null, input: unknown, at = AT, revision = 0) =>
  scoped((tx) => saveSpecialDay(tx, v.cfg, id, input, at, revision));
const read = (v: Venue, id: string) => scoped((tx) => readSpecialDay(tx, v.cfg, id));
const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return {
      code: (error as { code?: string }).code,
      params: (error as { params?: object }).params,
    };
  }
  throw new Error("expected a refusal");
};

const december = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `2030-12-${String(from + i).padStart(2, "0")}`);
const dates = (days: readonly string[]) => days.map((date) => ({ date, closedAllDay: false }));

async function christmasDinners(v: Venue) {
  const days = december(14, 23);
  return save(v, null, {
    name: "Christmas company dinners",
    repeatsYearly: false,
    dates: dates(days),
    paint: days.flatMap((date, i) => [
      {
        departmentId: v.restaurant,
        date,
        ranges: [
          { periodId: v.dinner, startsAt: "19:00", endsAt: `2${i % 4}:00` },
          { periodId: null, startsAt: "23:00", endsAt: "23:30" },
        ],
      },
      {
        departmentId: v.bar,
        date,
        ranges: [{ periodId: v.drinks, startsAt: "18:00", endsAt: `0${i % 3}:30` }],
      },
    ]),
    zonePaint: [
      {
        zoneId: v.sala,
        date: days[0],
        ranges: [{ kind: "open", startsAt: "12:00", endsAt: "13:00" }],
      },
    ],
  });
}

const paintOf = (detail: SpecialDayDetail, departmentId: string) =>
  detail.paint.filter((entry) => entry.departmentId === departmentId);
const dateRows = (specialDayId: string) =>
  db
    .select({ id: specialDayDates.id, date: specialDayDates.date })
    .from(specialDayDates)
    .where(eq(specialDayDates.specialDayId, specialDayId));

describe("saveSpecialDay", () => {
  it("keeps every date row and paint the request did not edit", async () => {
    const v = await venue();
    const before = await christmasDinners(v);
    const rowsBefore = await dateRows(before.id);
    expect(rowsBefore).toHaveLength(10);
    const edited = [{ periodId: v.lunch, startsAt: "13:00", endsAt: "16:30" }];

    const after = await save(v, before.id, {
      name: "Christmas company dinners",
      repeatsYearly: false,
      dates: dates(december(14, 24)),
      paint: [{ departmentId: v.restaurant, date: "2030-12-20", ranges: edited }],
    });

    expect(paintOf(after, v.bar)).toEqual(paintOf(before, v.bar));
    expect(paintOf(after, v.bar)).toHaveLength(10);
    expect(paintOf(after, v.restaurant).filter((entry) => entry.date !== "2030-12-20")).toEqual(
      paintOf(before, v.restaurant).filter((entry) => entry.date !== "2030-12-20"),
    );
    expect(paintOf(after, v.restaurant).find((entry) => entry.date === "2030-12-20")).toEqual({
      departmentId: v.restaurant,
      date: "2030-12-20",
      ranges: edited,
    });
    expect(after.zonePaint).toEqual(before.zonePaint);
    const rowsAfter = await dateRows(before.id);
    expect(rowsAfter).toHaveLength(11);
    for (const row of rowsBefore) expect(rowsAfter).toContainEqual(row);
    expect(await read(v, before.id)).toEqual(after);
  });

  it("deletes a removed date with its paint, and changes a kept date's Closed tick", async () => {
    const v = await venue();
    const before = await christmasDinners(v);
    const removed = (await dateRows(before.id)).find((row) => row.date === "2030-12-14")!;
    const after = await save(v, before.id, {
      name: "Christmas company dinners",
      repeatsYearly: false,
      dates: [...dates(december(15, 23)).slice(1), { date: "2030-12-15", closedAllDay: true }],
    });
    expect(after.dates).toContainEqual({ date: "2030-12-15", closedAllDay: true });
    expect(after.dates.map((entry) => entry.date)).not.toContain("2030-12-14");
    expect(after.paint.some((entry) => entry.date === "2030-12-14")).toBe(false);
    expect(after.zonePaint).toEqual([]);
    expect(
      await db.select().from(departmentDays).where(eq(departmentDays.specialDayDateId, removed.id)),
    ).toEqual([]);
    expect(
      await db.select().from(zoneDays).where(eq(zoneDays.specialDayDateId, removed.id)),
    ).toEqual([]);
  });

  it("clears one department's paint on a date given empty ranges", async () => {
    const v = await venue();
    const before = await christmasDinners(v);
    const after = await save(v, before.id, {
      name: "Christmas company dinners",
      repeatsYearly: false,
      dates: dates(december(14, 23)),
      paint: [{ departmentId: v.bar, date: "2030-12-14", ranges: [] }],
    });
    expect(paintOf(after, v.bar).map((entry) => entry.date)).toEqual(december(15, 23));
    expect(paintOf(after, v.restaurant)).toEqual(paintOf(before, v.restaurant));
  });

  it("refuses a date another special day holds, naming it", async () => {
    const v = await venue();
    const other = await christmasDinners(v);
    expect(
      await refusal(
        save(v, null, { name: "Nochebuena", repeatsYearly: false, dates: dates(["2030-12-18"]) }),
      ),
    ).toEqual({
      code: "special_day.date_taken",
      params: { date: "2030-12-18", specialDayId: other.id, name: "Christmas company dinners" },
    });
  });

  it("a repeating date collides with a one-off date only from its first year", async () => {
    const v = await venue();
    const oneOff = await save(v, null, {
      name: "Cena 2031",
      repeatsYearly: false,
      dates: dates(["2031-12-24"]),
    });
    expect(
      await refusal(
        save(v, null, { name: "Nochebuena", repeatsYearly: true, dates: dates(["2030-12-24"]) }),
      ),
    ).toEqual({
      code: "special_day.date_taken",
      params: { date: "2031-12-24", specialDayId: oneOff.id, name: "Cena 2031" },
    });
    const later = await save(v, null, {
      name: "Nochebuena",
      repeatsYearly: true,
      dates: dates(["2032-12-24"]),
    });
    expect(later.dates).toEqual([{ date: "2032-12-24", closedAllDay: false }]);
  });

  it("turning a special day repeating rechecks its kept dates", async () => {
    const v = await venue();
    const oneOff = await save(v, null, {
      name: "Cena 2031",
      repeatsYearly: false,
      dates: dates(["2031-12-24"]),
    });
    const nochebuena = await save(v, null, {
      name: "Nochebuena",
      repeatsYearly: false,
      dates: dates(["2030-12-24"]),
    });
    expect(
      await refusal(
        save(v, nochebuena.id, {
          name: "Nochebuena",
          repeatsYearly: true,
          dates: dates(["2030-12-24"]),
        }),
      ),
    ).toEqual({
      code: "special_day.date_taken",
      params: { date: "2031-12-24", specialDayId: oneOff.id, name: "Cena 2031" },
    });
  });

  it("refuses a date a named day holds, naming it", async () => {
    const v = await venue();
    const [named] = await db
      .insert(specialDates)
      .values({ locationId: v.cfg.locationId, date: "2030-12-25", name: "Navidad" })
      .returning({ id: specialDates.id });
    expect(
      await refusal(
        save(v, null, { name: "Christmas", repeatsYearly: false, dates: dates(["2030-12-25"]) }),
      ),
    ).toEqual({
      code: "special_day.date_taken",
      params: { date: "2030-12-25", specialDateId: named!.id, name: "Navidad" },
    });
    expect(
      await refusal(
        save(v, null, { name: "Christmas", repeatsYearly: true, dates: dates(["2029-12-25"]) }),
      ),
    ).toEqual({
      code: "special_day.date_taken",
      params: { date: "2030-12-25", specialDateId: named!.id, name: "Navidad" },
    });
    expect(
      await db.select().from(specialDays).where(eq(specialDays.locationId, v.cfg.locationId)),
    ).toEqual([]);
  });

  it("a repeating named day refuses a special day only from its first year", async () => {
    const v = await venue();
    const [named] = await db
      .insert(specialDates)
      .values({
        locationId: v.cfg.locationId,
        date: "2030-12-25",
        name: "Navidad",
        repeatOn: "12-25",
      })
      .returning({ id: specialDates.id });
    expect(
      await refusal(
        save(v, null, { name: "Christmas", repeatsYearly: false, dates: dates(["2031-12-25"]) }),
      ),
    ).toEqual({
      code: "special_day.date_taken",
      params: { date: "2031-12-25", specialDateId: named!.id, name: "Navidad" },
    });
    const before = await save(v, null, {
      name: "Christmas",
      repeatsYearly: false,
      dates: dates(["2029-12-25"]),
    });
    expect(before.dates).toEqual([{ date: "2029-12-25", closedAllDay: false }]);
  });

  it("names need not be unique", async () => {
    const v = await venue();
    const first = await save(v, null, {
      name: "Viernes Santo",
      repeatsYearly: false,
      dates: dates(["2026-04-03"]),
    });
    const second = await save(v, null, {
      name: "Viernes Santo",
      repeatsYearly: false,
      dates: dates(["2027-03-26"]),
    });
    expect(second.id).not.toBe(first.id);
    expect(second.name).toBe(first.name);
  });

  it("refuses one date twice in the input, and two dates a repeating day lands on together", async () => {
    const v = await venue();
    expect(
      await refusal(
        save(v, null, {
          name: "Twice",
          repeatsYearly: false,
          dates: dates(["2030-12-24", "2030-12-24"]),
        }),
      ),
    ).toEqual({
      code: "special_day.invalid",
      params: { field: "dates.1.date", reason: "overlap" },
    });
    expect(
      await refusal(
        save(v, null, {
          name: "Twice",
          repeatsYearly: true,
          dates: dates(["2030-12-24", "2031-12-24"]),
        }),
      ),
    ).toEqual({
      code: "special_day.invalid",
      params: { field: "dates.1.date", reason: "overlap" },
    });
  });

  it.each([
    [
      "overlap",
      [
        { periodId: null, startsAt: "12:00", endsAt: "14:00" },
        { periodId: null, startsAt: "13:00", endsAt: "15:00" },
      ],
    ],
    ["step", [{ periodId: null, startsAt: "12:10", endsAt: "14:00" }]],
    ["empty", [{ periodId: null, startsAt: "12:00", endsAt: "12:00" }]],
  ])("refuses paint ranges by shape: %s", async (reason, ranges) => {
    const v = await venue();
    expect(
      await refusal(
        save(v, null, {
          name: "Shape",
          repeatsYearly: false,
          dates: dates(["2030-12-24"]),
          paint: [{ departmentId: v.restaurant, date: "2030-12-24", ranges }],
        }),
      ),
    ).toEqual({ code: "special_day.invalid", params: { field: "paint.0.ranges", reason } });
  });

  it("refuses two paint entries for one department and date, and paint for a date it lacks", async () => {
    const v = await venue();
    const entry = {
      departmentId: v.restaurant,
      date: "2030-12-24",
      ranges: [{ periodId: null, startsAt: "12:00", endsAt: "14:00" }],
    };
    const input = { name: "Dup", repeatsYearly: false, dates: dates(["2030-12-24"]) };
    expect(await refusal(save(v, null, { ...input, paint: [entry, entry] }))).toEqual({
      code: "special_day.invalid",
      params: { field: "paint.1", reason: "overlap" },
    });
    expect(
      await refusal(save(v, null, { ...input, paint: [{ ...entry, date: "2030-12-25" }] })),
    ).toEqual({ code: "special_day.invalid", params: { field: "paint.0.date" } });
    const zone = { zoneId: v.sala, date: "2030-12-24", ranges: [] };
    expect(await refusal(save(v, null, { ...input, zonePaint: [zone, zone] }))).toEqual({
      code: "special_day.invalid",
      params: { field: "zonePaint.1", reason: "overlap" },
    });
  });

  it("refuses a period of another department", async () => {
    const v = await venue();
    expect(
      await refusal(
        save(v, null, {
          name: "Wrong period",
          repeatsYearly: false,
          dates: dates(["2030-12-24"]),
          paint: [
            {
              departmentId: v.restaurant,
              date: "2030-12-24",
              ranges: [{ periodId: v.drinks, startsAt: "12:00", endsAt: "14:00" }],
            },
          ],
        }),
      ),
    ).toEqual({
      code: "special_day.invalid",
      params: { field: "paint.0.ranges.0.periodId", departmentId: v.restaurant },
    });
  });

  it("names a refused range by its place in the request, not in changeover order", async () => {
    const v = await venue();
    const input = (date: string, ranges: unknown[]) => ({
      name: "Order",
      repeatsYearly: false,
      dates: dates([date]),
      paint: [{ departmentId: v.restaurant, date, ranges }],
    });
    expect(
      await refusal(
        save(
          v,
          null,
          input("2030-12-24", [
            { periodId: v.lunch, startsAt: "14:00", endsAt: "16:00" },
            { periodId: v.drinks, startsAt: "12:00", endsAt: "14:00" },
          ]),
        ),
      ),
    ).toEqual({
      code: "special_day.invalid",
      params: { field: "paint.0.ranges.1.periodId", departmentId: v.restaurant },
    });
    expect(
      await refusal(
        save(
          v,
          null,
          input("2026-03-28", [
            { periodId: v.dinner, startsAt: "05:00", endsAt: "05:30" },
            { periodId: v.dinner, startsAt: "02:15", endsAt: "04:00" },
          ]),
          new Date("2026-01-10"),
        ),
      ),
    ).toEqual({
      code: "special_day.invalid",
      params: { field: "paint.0.ranges.1.startsAt", reason: "clock_skips", date: "2026-03-28" },
    });
  });

  it("refuses a zone paint kind it does not know", async () => {
    const v = await venue();
    expect(
      await refusal(
        save(v, null, {
          name: "Kind",
          repeatsYearly: false,
          dates: dates(["2030-12-24"]),
          zonePaint: [
            {
              zoneId: v.sala,
              date: "2030-12-24",
              ranges: [{ kind: "shut", startsAt: "12:00", endsAt: "14:00" }],
            },
          ],
        }),
      ),
    ).toEqual({ code: "special_day.invalid", params: { field: "zonePaint.0.ranges.0.kind" } });
  });

  it.each([
    ["name", { name: "  " }],
    ["repeatsYearly", { repeatsYearly: "yes" }],
    ["dates.0.date", { dates: [{ date: "2030-02-30", closedAllDay: false }] }],
    ["dates.0.closedAllDay", { dates: [{ date: "2030-12-24" }] }],
    ["dates", { dates: "2030-12-24" }],
    ["dates.0", { dates: ["2030-12-24"] }],
    ["paint", { paint: {} }],
    ["paint.0.departmentId", { paint: [{ departmentId: "bar", date: "2030-12-24", ranges: [] }] }],
    [
      "paint.0.ranges.0.periodId",
      {
        paint: [
          {
            departmentId: randomUUID(),
            date: "2030-12-24",
            ranges: [{ periodId: "lunch", startsAt: "12:00", endsAt: "14:00" }],
          },
        ],
      },
    ],
    [
      "paint.0.ranges.0.startsAt",
      {
        paint: [
          {
            departmentId: randomUUID(),
            date: "2030-12-24",
            ranges: [{ periodId: null, startsAt: "noon", endsAt: "14:00" }],
          },
        ],
      },
    ],
  ])("refuses a malformed %s", async (field, change) => {
    const v = await venue();
    expect(
      await refusal(
        save(v, null, {
          name: "Malformed",
          repeatsYearly: false,
          dates: dates(["2030-12-24"]),
          ...change,
        }),
      ),
    ).toEqual({ code: "special_day.invalid", params: { field } });
  });

  it("refuses an input that is not an object", async () => {
    const v = await venue();
    expect(await refusal(save(v, null, ["Nochebuena"]))).toEqual({
      code: "special_day.invalid",
      params: { field: "input" },
    });
  });

  it("refuses a one-off date a repeating special day reaches in a later year", async () => {
    const v = await venue();
    const every = await save(v, null, {
      name: "Nochebuena",
      repeatsYearly: true,
      dates: dates(["2030-12-24"]),
    });
    expect(
      await refusal(
        save(v, null, { name: "Cena", repeatsYearly: false, dates: dates(["2033-12-24"]) }),
      ),
    ).toEqual({
      code: "special_day.date_taken",
      params: { date: "2033-12-24", specialDayId: every.id, name: "Nochebuena" },
    });
  });

  it("saves and reads a special day with no dates, and clears a zone's paint given empty ranges", async () => {
    const v = await venue();
    expect(
      await save(v, null, { name: "Sin fechas", repeatsYearly: false, dates: [] }),
    ).toMatchObject({ name: "Sin fechas", dates: [], paint: [], zonePaint: [] });
    const before = await christmasDinners(v);
    const after = await save(v, before.id, {
      name: "Christmas company dinners",
      repeatsYearly: false,
      dates: dates(december(14, 23)),
      zonePaint: [{ zoneId: v.sala, date: "2030-12-14", ranges: [] }],
    });
    expect(after.zonePaint).toEqual([]);
    expect(after.paint).toEqual(before.paint);
  });

  it("stores touching paint of one period, or of Closed, as one range, and of two periods as two", async () => {
    const v = await venue();
    const saved = await save(v, null, {
      name: "Touching",
      repeatsYearly: false,
      dates: dates(["2030-12-24", "2030-12-25"]),
      paint: [
        {
          departmentId: v.restaurant,
          date: "2030-12-24",
          ranges: [
            { periodId: v.lunch, startsAt: "12:00", endsAt: "14:00" },
            { periodId: v.lunch, startsAt: "14:00", endsAt: "16:00" },
            { periodId: v.dinner, startsAt: "16:00", endsAt: "18:00" },
          ],
        },
        {
          departmentId: v.restaurant,
          date: "2030-12-25",
          ranges: [
            { periodId: null, startsAt: "12:00", endsAt: "14:00" },
            { periodId: null, startsAt: "14:00", endsAt: "16:00" },
          ],
        },
      ],
    });
    expect(saved.paint).toEqual([
      {
        departmentId: v.restaurant,
        date: "2030-12-24",
        ranges: [
          { periodId: v.lunch, startsAt: "12:00", endsAt: "16:00" },
          { periodId: v.dinner, startsAt: "16:00", endsAt: "18:00" },
        ],
      },
      {
        departmentId: v.restaurant,
        date: "2030-12-25",
        ranges: [{ periodId: null, startsAt: "12:00", endsAt: "16:00" }],
      },
    ]);
  });

  it("stores touching zone paint of one kind as one range, and of two kinds as two", async () => {
    const v = await venue();
    const saved = await save(v, null, {
      name: "Touching zone",
      repeatsYearly: false,
      dates: dates(["2030-12-24"]),
      zonePaint: [
        {
          zoneId: v.sala,
          date: "2030-12-24",
          ranges: [
            { kind: "closed", startsAt: "12:00", endsAt: "14:00" },
            { kind: "closed", startsAt: "14:00", endsAt: "16:00" },
            { kind: "open", startsAt: "16:00", endsAt: "18:00" },
          ],
        },
      ],
    });
    expect(saved.zonePaint).toEqual([
      {
        zoneId: v.sala,
        date: "2030-12-24",
        ranges: [
          { kind: "closed", startsAt: "12:00", endsAt: "16:00" },
          { kind: "open", startsAt: "16:00", endsAt: "18:00" },
        ],
      },
    ]);
  });

  it("saves without the clock-skip check when the venue's clock cannot be read", async () => {
    const v = await venue();
    await db
      .update(locations)
      .set({ timeZone: "Mars/Base" })
      .where(eq(locations.id, v.cfg.locationId));
    const saved = await save(
      v,
      null,
      {
        name: "Cambio de hora",
        repeatsYearly: false,
        dates: dates(["2026-03-28"]),
        paint: [
          {
            departmentId: v.restaurant,
            date: "2026-03-28",
            ranges: [{ periodId: v.dinner, startsAt: "02:15", endsAt: "04:00" }],
          },
        ],
      },
      new Date("2026-01-10"),
    );
    expect(saved.paint).toEqual([
      {
        departmentId: v.restaurant,
        date: "2026-03-28",
        ranges: [{ periodId: v.dinner, startsAt: "02:15", endsAt: "04:00" }],
      },
    ]);
  });

  it("a Closed range on a season week is still refused by the week's own parser", async () => {
    const v = await venue();
    const week = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      slots: weekday === 2 ? [{ periodId: null, startsAt: "12:00", endsAt: "14:00" }] : [],
    }));
    expect(
      await refusal(scoped((tx) => replaceMenuWeek(tx, v.cfg, v.restaurant, week, AT, 0))),
    ).toEqual({ code: "menu_timetable.invalid", params: { field: "days.2.slots.0.periodId" } });
  });

  it.each([
    ["department", "department.not_found", { departmentId: "" }],
    ["zone", "service_zone.not_found", { zoneId: "" }],
  ])("refuses paint for a %s that does not exist, writing nothing", async (_kind, code, params) => {
    const v = await venue();
    const before = await christmasDinners(v);
    const missing = randomUUID();
    const ranges = [{ periodId: null, startsAt: "12:00", endsAt: "14:00" }];
    const zoneRanges = [{ kind: "closed", startsAt: "12:00", endsAt: "14:00" }];
    const input = {
      name: "Renamed",
      repeatsYearly: false,
      dates: dates(december(10, 12)),
      paint: [
        { departmentId: v.bar, date: "2030-12-10", ranges },
        ...("departmentId" in params
          ? [{ departmentId: missing, date: "2030-12-11", ranges }]
          : []),
      ],
      zonePaint:
        "zoneId" in params ? [{ zoneId: missing, date: "2030-12-11", ranges: zoneRanges }] : [],
    };
    const key = Object.keys(params)[0]!;
    expect(await refusal(save(v, before.id, input))).toEqual({
      code,
      params: { [key]: missing },
    });
    expect(await read(v, before.id)).toEqual(before);
  });

  it("refuses a stale clock revision, writing nothing", async () => {
    const v = await venue();
    const before = await christmasDinners(v);
    const input = { name: "Renamed", repeatsYearly: false, dates: dates(["2030-12-01"]) };
    expect(await refusal(save(v, before.id, input, AT, 1))).toEqual({
      code: "hours.clock_changed",
      params: {},
    });
    expect(await refusal(save(v, null, input, AT, 1))).toEqual({
      code: "hours.clock_changed",
      params: {},
    });
    expect(await read(v, before.id)).toEqual(before);
    expect(
      await db.select().from(specialDays).where(eq(specialDays.locationId, v.cfg.locationId)),
    ).toHaveLength(1);
  });

  it("refuses an id it does not hold", async () => {
    const v = await venue();
    const missing = randomUUID();
    const input = { name: "Nope", repeatsYearly: false, dates: dates(["2030-12-01"]) };
    expect(await refusal(save(v, missing, input))).toEqual({
      code: "special_day.not_found",
      params: { specialDayId: missing },
    });
    const other = await venue();
    const theirs = await christmasDinners(other);
    expect(await refusal(save(v, theirs.id, input))).toEqual({
      code: "special_day.not_found",
      params: { specialDayId: theirs.id },
    });
  });

  describe("clock skips (Europe/Madrid, changeover 06:00)", () => {
    const skipping = (date: string, repeatsYearly: boolean, v: Venue) => ({
      name: "Cambio de hora",
      repeatsYearly,
      dates: dates([date]),
      paint: [
        {
          departmentId: v.restaurant,
          date,
          ranges: [{ periodId: v.dinner, startsAt: "02:15", endsAt: "04:00" }],
        },
      ],
    });

    it("refuses paint at 02:15 on business day 2026-03-28, which the clocks skip on 29 March", async () => {
      const v = await venue();
      expect(
        await refusal(save(v, null, skipping("2026-03-28", false, v), new Date("2026-01-10"))),
      ).toEqual({
        code: "special_day.invalid",
        params: { field: "paint.0.ranges.0.startsAt", reason: "clock_skips", date: "2026-03-28" },
      });
    });

    it("saves the same paint on business day 2026-03-29 (02:15 on 30 March exists)", async () => {
      const v = await venue();
      const saved = await save(v, null, skipping("2026-03-29", false, v), new Date("2026-01-10"));
      expect(saved.paint).toHaveLength(1);
    });

    it("checks a repeating date at its next occurrence from `at`", async () => {
      const v = await venue();
      // Stored 2025-03-28 is fine (2025's change was on 30 March); its 2026 occurrence is not.
      expect(
        await refusal(save(v, null, skipping("2025-03-28", true, v), new Date("2026-01-10"))),
      ).toEqual({
        code: "special_day.invalid",
        params: { field: "paint.0.ranges.0.startsAt", reason: "clock_skips", date: "2026-03-28" },
      });
      // After it, the next occurrence is 2027-03-28, whose night (28 → 29 March) skips nothing.
      const saved = await save(v, null, skipping("2025-03-28", true, v), new Date("2026-04-01"));
      expect(saved.paint).toHaveLength(1);
    });
  });
});

describe("deleteSpecialDay", () => {
  it("deletes the special day, its dates and every paint row", async () => {
    const v = await venue();
    const before = await christmasDinners(v);
    const ids = (await dateRows(before.id)).map((row) => row.id);
    await scoped((tx) => deleteSpecialDay(tx, v.cfg, before.id, AT, 0));
    expect(await refusal(read(v, before.id))).toEqual({
      code: "special_day.not_found",
      params: { specialDayId: before.id },
    });
    expect(await dateRows(before.id)).toEqual([]);
    expect(
      await db.select().from(departmentDays).where(inArray(departmentDays.specialDayDateId, ids)),
    ).toEqual([]);
    expect(await db.select().from(zoneDays).where(inArray(zoneDays.specialDayDateId, ids))).toEqual(
      [],
    );
  });

  it("refuses a stale revision and an unknown id, deleting nothing", async () => {
    const v = await venue();
    const before = await christmasDinners(v);
    expect(await refusal(scoped((tx) => deleteSpecialDay(tx, v.cfg, before.id, AT, 1)))).toEqual({
      code: "hours.clock_changed",
      params: {},
    });
    const missing = randomUUID();
    expect(await refusal(scoped((tx) => deleteSpecialDay(tx, v.cfg, missing, AT, 0)))).toEqual({
      code: "special_day.not_found",
      params: { specialDayId: missing },
    });
    expect(await read(v, before.id)).toEqual(before);
  });
});
