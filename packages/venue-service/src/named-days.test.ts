import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, catalogues, locations, tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { replaceMenuWeek, resolveDepartmentService, saveMenuPeriod } from "./menu-timetable.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { readSpecialDaysModel } from "./named-days.js";
import { specialDates } from "./schema/hours.js";
import {
  departmentDayRanges,
  departmentDays,
  specialDayDates,
  specialDays,
} from "./schema/seasons.js";
import { departments, departmentSalePolicies } from "./schema/service.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
const now = new Date("2026-10-09T10:00:00Z");
const run = <T>(body: Parameters<typeof withTransaction<T>>[1]) => withTransaction(suite.db, body);

async function fixture() {
  return run(async (tx) => {
    const [location] = await tx
      .insert(locations)
      .values({
        name: randomUUID(),
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
        timeZone: "Europe/Madrid",
        dayCutover: "06:00:00",
      })
      .returning();
    const cfg = { locationId: locationId(location!.id) };
    const [department, other] = await tx
      .insert(departments)
      .values([
        {
          locationId: cfg.locationId,
          name: "Dining",
          tradingName: "Dining",
          isDefault: true,
        },
        {
          locationId: cfg.locationId,
          name: "Terrace",
          tradingName: "Terrace",
        },
      ])
      .returning();
    await tx.insert(departmentSalePolicies).values(
      [department!, other!].map((row) => ({
        departmentId: row.id,
        orderStart: "table" as const,
      })),
    );
    const [menu] = await tx.insert(catalogues).values({ name: randomUUID() }).returning();
    const ids = [];
    for (const owner of [department!, other!]) {
      const period = await saveMenuPeriod(
        tx,
        cfg,
        owner.id,
        {
          name: "Lunch",
          menuId: menu!.id,
          staffMenuIds: [],
        },
        0,
      );
      await replaceMenuWeek(
        tx,
        cfg,
        owner.id,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: [{ periodId: period.id, startsAt: "12:00", endsAt: "16:00" }],
        })),
        now,
        0,
      );
      ids.push(period.id);
    }
    return {
      cfg,
      department: department!.id,
      other: other!.id,
      period: ids[0]!,
      otherPeriod: ids[1]!,
      menu: menu!.id,
    };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function special(
  f: Fixture,
  name: string,
  dates: readonly (string | { date: string; closedAllDay: boolean })[],
  repeatsYearly = false,
  paint: readonly { periodId: string | null; startsAt: string; endsAt: string }[] = [],
) {
  return run(async (tx) => {
    const [row] = await tx
      .insert(specialDays)
      .values({ locationId: f.cfg.locationId, name, repeatsYearly })
      .returning({ id: specialDays.id });
    for (const entry of dates) {
      const { date, closedAllDay } =
        typeof entry === "string" ? { date: entry, closedAllDay: false } : entry;
      const [stored] = await tx
        .insert(specialDayDates)
        .values({ specialDayId: row!.id, locationId: f.cfg.locationId, date, closedAllDay })
        .returning({ id: specialDayDates.id });
      if (paint.length === 0) continue;
      const [day] = await tx
        .insert(departmentDays)
        .values({ departmentId: f.department, specialDayDateId: stored!.id })
        .returning({ id: departmentDays.id });
      await tx
        .insert(departmentDayRanges)
        .values(paint.map((range) => ({ dayId: day!.id, departmentId: f.department, ...range })));
    }
    return row!.id;
  });
}
async function day(
  f: Fixture,
  date: string,
  overrides: Partial<typeof specialDates.$inferInsert> = {},
) {
  return run(async (tx) => {
    const [row] = await tx
      .insert(specialDates)
      .values({
        locationId: f.cfg.locationId,
        date,
        name: "Navidad",
        ...overrides,
      })
      .returning();
    return row!;
  });
}
const service = (f: Fixture, at: string, department = f.department) =>
  run((tx) => resolveDepartmentService(tx, f.cfg, department, new Date(at)));
const read = (
  f: Fixture,
  from: string,
  to = from,
  facts: readonly import("./hours-types.js").HolidayFact[] = [],
) => run((tx) => readSpecialDaysModel(tx, f.cfg, from, to, now, async () => facts));
const named = async (f: Fixture, from: string, to = from) =>
  (await read(f, from, to)).days.flatMap(({ date, specialDay }) =>
    specialDay === null ? [] : [{ date, ...specialDay }],
  );

describe("special-day occurrences in the Calendar", () => {
  it("shows a repeating special day on each occurrence, and never before its first year", async () => {
    const f = await fixture();
    const id = await special(f, "Navidad", [{ date: "2026-12-25", closedAllDay: true }], true);
    expect(await named(f, "2025-12-25")).toEqual([]);
    expect(await named(f, "2027-12-25", "2027-12-26")).toEqual([
      { date: "2027-12-25", id, name: "Navidad" },
    ]);
  });
  it("includes both ends, respects one-offs and leap days, and sorts a range across years", async () => {
    const f = await fixture();
    const leap = await special(f, "Leap", ["2024-02-29"], true);
    const christmas = await special(f, "Navidad", ["2026-12-25"], true);
    const one = await special(f, "New Year", ["2028-01-01"]);
    expect(
      (await named(f, "2027-12-25", "2028-02-29")).map(({ id, date }) => ({ id, date })),
    ).toEqual([
      { id: christmas, date: "2027-12-25" },
      { id: one, date: "2028-01-01" },
      { id: leap, date: "2028-02-29" },
    ]);
  });
  it("ignores another venue's special days", async () => {
    const f = await fixture();
    const other = await fixture();
    await special(other, "Navidad", [{ date: "2020-12-25", closedAllDay: true }], true);
    expect(await read(f, "2027-12-25")).toMatchObject({
      days: [{ date: "2027-12-25", specialDay: null, tone: "standard", closed: false }],
    });
  });
});

describe("departments and calendar follow named days", () => {
  it("uses a repeating special day's range through a skipped clock minute in a later year", async () => {
    const f = await fixture();
    await run(async (tx) => {
      const [special] = await tx
        .insert(specialDays)
        .values({ locationId: f.cfg.locationId, name: "Navidad", repeatsYearly: true })
        .returning({ id: specialDays.id });
      const [date] = await tx
        .insert(specialDayDates)
        .values({ specialDayId: special!.id, locationId: f.cfg.locationId, date: "2026-03-27" })
        .returning({ id: specialDayDates.id });
      const [paint] = await tx
        .insert(departmentDays)
        .values({ departmentId: f.department, specialDayDateId: date!.id })
        .returning({ id: departmentDays.id });
      await tx.insert(departmentDayRanges).values({
        dayId: paint!.id,
        departmentId: f.department,
        periodId: f.period,
        startsAt: "02:30:00",
        endsAt: "04:00:00",
      });
    });
    expect((await service(f, "2027-03-28T01:00:00Z")).periodId).toBe(f.period);
    expect((await service(f, "2027-03-28T02:00:00Z")).open).toBe(false);
  });
});

describe("special-days Calendar model", () => {
  const christmas = (scope: "national" | "regional" | "local") => ({
    id: "public",
    date: "2026-12-25",
    name: "Christmas",
    scope,
    sourceId: "official",
  });
  it("keeps the public-holiday tone, with its special day attached, on a public holiday edited into a special day", async () => {
    const f = await fixture();
    const id = await special(f, "Anniversary", ["2026-12-25"], false, [
      { periodId: f.period, startsAt: "12:00", endsAt: "18:00" },
    ]);
    const model = await read(f, "2026-12-25", "2026-12-25", [christmas("national")]);
    expect(model.days).toEqual([
      {
        date: "2026-12-25",
        specialDay: { id, name: "Anniversary" },
        holidays: [christmas("national")],
        tone: "public_holiday",
        closed: false,
      },
    ]);
    expect(model).toMatchObject({
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
      civilDate: "2026-10-09",
      clockReadable: true,
      area: { options: [], required: false, chosen: null },
      localHolidaysPerYear: 0,
    });
  });
  it("draws a special day as a special day, in a later year too, and a local holiday does not change that", async () => {
    const f = await fixture();
    const id = await special(f, "Navidad", ["2026-12-25"], true);
    expect((await read(f, "2027-12-25")).days).toEqual([
      {
        date: "2027-12-25",
        specialDay: { id, name: "Navidad" },
        holidays: [],
        tone: "special_day",
        closed: false,
      },
    ]);
    expect((await read(f, "2026-12-25", "2026-12-25", [christmas("local")])).days[0]).toMatchObject(
      { tone: "special_day", holidays: [christmas("local")] },
    );
  });
  it("keeps a closed public holiday red independently of its closure", async () => {
    const f = await fixture();
    await special(f, "Navidad", [{ date: "2026-12-25", closedAllDay: true }]);
    expect(
      (await read(f, "2026-12-25", "2026-12-25", [christmas("regional")])).days[0],
    ).toMatchObject({ tone: "public_holiday", closed: true });
  });
  it("marks closure from a special day's Closed paint and ignores inactive departments", async () => {
    const f = await fixture();
    await special(f, "Navidad", ["2026-12-25"], false, [
      { periodId: null, startsAt: "12:00", endsAt: "16:00" },
    ]);
    expect((await read(f, "2026-12-25")).days[0]).toMatchObject({
      tone: "special_day",
      closed: false,
    });
    await suite.db.update(departments).set({ active: false }).where(eq(departments.id, f.other));
    expect((await read(f, "2026-12-25")).days[0]).toMatchObject({
      tone: "special_day",
      closed: true,
    });
    expect((await read(f, "2026-12-26")).days[0]).toMatchObject({
      tone: "standard",
      specialDay: null,
      closed: false,
    });
    await suite.db
      .update(departments)
      .set({ active: false })
      .where(eq(departments.id, f.department));
    expect((await read(f, "2026-12-26")).days[0]).toMatchObject({ tone: "closed", closed: true });
  });
  it("reads the same number of statements whatever the number of active departments", async () => {
    const f = await fixture();
    await special(f, "Navidad", ["2026-12-25"], false, [
      { periodId: null, startsAt: "12:00", endsAt: "13:00" },
    ]);
    const statements = () =>
      run(async (tx) => {
        const reads = vi.spyOn(tx, "select");
        await readSpecialDaysModel(tx, f.cfg, "2026-12-24", "2026-12-26", now);
        const count = reads.mock.calls.length;
        reads.mockRestore();
        return count;
      });
    await suite.db.update(departments).set({ active: false }).where(eq(departments.id, f.other));
    const one = await statements();
    await suite.db.update(departments).set({ active: true }).where(eq(departments.id, f.other));
    await suite.db.insert(departments).values({
      locationId: f.cfg.locationId,
      name: "Bar",
      tradingName: "Bar",
    });
    expect(await statements()).toBe(one);
  });
  it("ignores the retired named days", async () => {
    const f = await fixture();
    await day(f, "2026-12-25", { kind: "holiday", closeWholeVenue: true });
    expect((await read(f, "2026-12-25")).days[0]).toEqual({
      date: "2026-12-25",
      specialDay: null,
      holidays: [],
      tone: "standard",
      closed: false,
    });
  });
});

it("returns the country's area options and the chosen venue area without inventing a geography", async () => {
  const f = await fixture();
  await run(async (tx) => {
    await tx
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "X0000000", legalName: "Invented SL" })
      .onConflictDoUpdate({ target: tenants.id, set: { country: "ES" } });
    await tx
      .update(locations)
      .set({ province: "Santa Cruz de Tenerife", city: "Santa Cruz" })
      .where(eq(locations.id, f.cfg.locationId));
  });
  const before = await run((tx) =>
    readSpecialDaysModel(tx, f.cfg, "2026-02-02", "2026-02-02", now),
  );
  expect(before.area).toEqual({
    addressKey: JSON.stringify(["ES", "38", "santa cruz"]),
    readiness: "ready",
    options: [
      { key: "el-hierro", name: "El Hierro" },
      { key: "la-gomera", name: "La Gomera" },
      { key: "la-palma", name: "La Palma" },
      { key: "tenerife", name: "Tenerife" },
    ],
    required: true,
    chosen: null,
  });
  expect(before.localHolidaysPerYear).toBe(2);
  const { saveHolidayArea } = await import("./holidays.js");
  await run((tx) => saveHolidayArea(tx, f.cfg, { areaKey: "tenerife" }));
  const after = await run((tx) => readSpecialDaysModel(tx, f.cfg, "2026-02-02", "2026-02-02", now));
  expect(after.area).toEqual({ ...before.area, required: false, chosen: "tenerife" });
  expect(after.days[0]!.tone).toBe("public_holiday");
  await suite.db
    .update(locations)
    .set({ timeZone: "unreadable" })
    .where(eq(locations.id, f.cfg.locationId));
  expect(
    await run((tx) => readSpecialDaysModel(tx, f.cfg, "2026-02-02", "2026-02-02", now)),
  ).toMatchObject({
    civilDate: null,
    clockReadable: false,
    days: [{ date: "2026-02-02", tone: "public_holiday", closed: false }],
  });
});
