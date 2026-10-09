import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  catalogues,
  kitchenStations,
  locations,
  tenants,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { readCalendarDays } from "./hours.js";
import {
  readOpeningHoursModel,
  replaceMenuWeek,
  resolveDepartmentService,
  saveMenuPeriod,
} from "./menu-timetable.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import * as namedDayReads from "./named-days.js";
import { namedDaysBetween, namedDaysOn } from "./named-days.js";
import { specialDateHours, specialDates } from "./schema/hours.js";
import { menuDayTimetables, menuSlots } from "./schema/menus.js";
import { departments } from "./schema/service.js";

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
          defaultServiceMode: "table_tab",
          isDefault: true,
        },
        {
          locationId: cfg.locationId,
          name: "Terrace",
          tradingName: "Terrace",
          defaultServiceMode: "table_tab",
        },
      ])
      .returning();
    const [menu] = await tx.insert(catalogues).values({ name: randomUUID() }).returning();
    const ids = [];
    for (const owner of [department!, other!]) {
      const period = await saveMenuPeriod(tx, cfg, owner.id, {
        name: "Lunch",
        menuId: menu!.id,
        staffMenuIds: [],
      });
      await replaceMenuWeek(
        tx,
        cfg,
        owner.id,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: [{ periodId: period.id, startsAt: "12:00", endsAt: "16:00" }],
        })),
        now,
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
        colour: "purple",
        ...overrides,
      })
      .returning();
    return row!;
  });
}
async function dated(f: Fixture, id: string, startsAt?: string, endsAt = "15:00:00") {
  await run(async (tx) => {
    const [row] = await tx
      .insert(menuDayTimetables)
      .values({ departmentId: f.department, specialDateId: id })
      .returning();
    if (startsAt !== undefined)
      await tx.insert(menuSlots).values({
        timetableId: row!.id,
        departmentId: f.department,
        periodId: f.period,
        startsAt,
        endsAt,
      });
  });
}
const service = (f: Fixture, at: string, department = f.department) =>
  run((tx) => resolveDepartmentService(tx, f.cfg, department, new Date(at)));

describe("named-day occurrences read from the venue", () => {
  it("returns the stored identity on each occurrence, and never before its first year", async () => {
    const f = await fixture();
    const row = await day(f, "2026-12-25", {
      repeatOn: "12-25",
      kind: "holiday",
      closeWholeVenue: true,
    });
    const found = await run((tx) =>
      namedDaysOn(tx, f.cfg, ["2025-12-25", "2026-12-25", "2027-12-25", "2027-12-26"]),
    );
    expect([...found.keys()]).toEqual(["2026-12-25", "2027-12-25"]);
    expect(found.get("2027-12-25")).toEqual({
      id: row.id,
      date: "2027-12-25",
      storedDate: "2026-12-25",
      name: "Navidad",
      kind: "holiday",
      repeats: true,
      ownHours: false,
      closeWholeVenue: true,
    });
  });
  it("includes both ends, respects one-offs and leap days, and sorts a range across years", async () => {
    const f = await fixture();
    const leap = await day(f, "2024-02-29", { repeatOn: "02-29", ownHours: true });
    const christmas = await day(f, "2026-12-25", { repeatOn: "12-25" });
    const one = await day(f, "2028-01-01");
    const found = await run((tx) => namedDaysBetween(tx, f.cfg, "2027-12-25", "2028-02-29"));
    expect(found.map(({ id, date }) => ({ id, date }))).toEqual([
      { id: christmas.id, date: "2027-12-25" },
      { id: one.id, date: "2028-01-01" },
      { id: leap.id, date: "2028-02-29" },
    ]);
    expect(await run((tx) => namedDaysOn(tx, f.cfg, []))).toEqual(new Map());
  });
  it("ignores another venue's named days", async () => {
    const f = await fixture();
    const other = await fixture();
    await day(other, "2020-12-25", { repeatOn: "12-25", closeWholeVenue: true });
    expect(await run((tx) => namedDaysOn(tx, f.cfg, ["2027-12-25"]))).toEqual(new Map());
  });
});

describe("departments and calendar follow named days", () => {
  it("closes on a repeating day but follows Lunch in the year before it starts", async () => {
    const f = await fixture();
    await day(f, "2026-12-25", { repeatOn: "12-25", closeWholeVenue: true });
    expect((await service(f, "2027-12-25T12:00:00Z")).open).toBe(false);
    expect((await service(f, "2025-12-25T12:00:00Z")).periodId).toBe(f.period);
    const calendar = await run((tx) => readCalendarDays(tx, f.cfg, "2027-12-25", "2027-12-25"));
    expect(calendar[0]!.tone).toBe("closed");
    expect(calendar[0]!.specialDate?.name).toBe("Navidad");
  });
  it("ignores a retained empty dated row when own hours is off, in resolver and calendar", async () => {
    const f = await fixture();
    const row = await day(f, "2026-12-25");
    await dated(f, row.id);
    expect((await service(f, "2026-12-25T12:00:00Z")).periodId).toBe(f.period);
    await suite.db.update(departments).set({ active: false }).where(eq(departments.id, f.other));
    expect(
      (await run((tx) => readCalendarDays(tx, f.cfg, "2026-12-25", "2026-12-25")))[0]!.tone,
    ).toBe("purple");
  });
  it("uses own hours on repeating dates and the normal week for a department with no row", async () => {
    const f = await fixture();
    const row = await day(f, "2026-12-25", { repeatOn: "12-25", ownHours: true });
    await dated(f, row.id, "13:00:00");
    expect((await service(f, "2027-12-25T11:30:00Z")).open).toBe(false);
    expect((await service(f, "2027-12-25T13:00:00Z")).periodId).toBe(f.period);
    expect((await service(f, "2027-12-25T11:30:00Z", f.other)).periodId).toBe(f.otherPeriod);
    expect((await service(f, "2027-12-25T14:00:00Z")).open).toBe(false);
  });
  it("closes an own-hours date with an empty department row", async () => {
    const f = await fixture();
    const row = await day(f, "2026-12-25", { repeatOn: "12-25", ownHours: true });
    await dated(f, row.id);
    expect((await service(f, "2027-12-25T12:00:00Z")).open).toBe(false);
    await suite.db.update(departments).set({ active: false }).where(eq(departments.id, f.other));
    expect(
      (await run((tx) => readCalendarDays(tx, f.cfg, "2027-12-25", "2027-12-25")))[0]!.tone,
    ).toBe("closed");
  });
  it("uses the business day's own range through a skipped clock minute in a later year", async () => {
    const f = await fixture();
    const row = await day(f, "2026-03-27", { repeatOn: "03-27", ownHours: true });
    await dated(f, row.id, "02:30:00", "04:00:00");
    expect((await service(f, "2027-03-28T01:00:00Z")).periodId).toBe(f.period);
    expect((await service(f, "2027-03-28T02:00:00Z")).open).toBe(false);
  });
  it("lists old repeats, future one-offs and past days still holding dated rows", async () => {
    const f = await fixture();
    const repeat = await day(f, "2020-12-25", { repeatOn: "12-25" });
    await day(f, "2026-09-09");
    const retained = await day(f, "2026-09-10", { ownHours: true });
    await dated(f, retained.id);
    const future = await day(f, "2026-12-26");
    const model = await run((tx) => readOpeningHoursModel(tx, f.cfg, now));
    expect(model.namedDays.map(({ id }) => id)).toEqual([repeat.id, retained.id, future.id]);
  });
});

describe("named-days Calendar model", () => {
  const read = async (
    f: Fixture,
    from: string,
    to = from,
    facts: readonly import("./hours-types.js").HolidayFact[] = [],
  ) => {
    expect(namedDayReads).toHaveProperty("readNamedDaysModel", expect.any(Function));
    return run((tx) =>
      namedDayReads.readNamedDaysModel(tx, f.cfg, from, to, now, async () => facts),
    );
  };
  it("keeps both names and public tone when a named working day shares a public holiday", async () => {
    const f = await fixture();
    const row = await day(f, "2026-12-25", { name: "Anniversary", ownHours: true });
    const holiday = {
      id: "public",
      date: "2026-12-25",
      name: "Christmas",
      scope: "national" as const,
      sourceId: "official",
    };
    const model = await read(f, "2026-12-25", "2026-12-25", [holiday]);
    expect(model.days).toEqual([
      {
        date: "2026-12-25",
        namedDay: {
          id: row.id,
          date: "2026-12-25",
          name: "Anniversary",
          kind: "working_day",
          repeats: false,
          ownHours: true,
          closeWholeVenue: false,
          hasStationHours: false,
        },
        holidays: [holiday],
        tone: "public_holiday",
        ownHours: true,
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
  it("shows a repeating own holiday in a later year with its stored identity", async () => {
    const f = await fixture();
    const row = await day(f, "2026-12-25", { repeatOn: "12-25", kind: "holiday" });
    expect((await read(f, "2027-12-25")).days).toEqual([
      {
        date: "2027-12-25",
        namedDay: {
          id: row.id,
          date: "2026-12-25",
          name: "Navidad",
          kind: "holiday",
          repeats: true,
          ownHours: false,
          closeWholeVenue: false,
          hasStationHours: false,
        },
        holidays: [],
        tone: "own_holiday",
        ownHours: false,
        closed: false,
      },
    ]);
  });
  it("keeps a closed public holiday red independently of its closure", async () => {
    const f = await fixture();
    await day(f, "2026-12-25", { closeWholeVenue: true });
    const holiday = {
      id: "public",
      date: "2026-12-25",
      name: "Christmas",
      scope: "regional" as const,
      sourceId: "official",
    };
    expect((await read(f, "2026-12-25", "2026-12-25", [holiday])).days[0]).toMatchObject({
      tone: "public_holiday",
      closed: true,
      ownHours: false,
    });
  });
  it("marks closure from empty own department hours and ignores inactive departments", async () => {
    const f = await fixture();
    const row = await day(f, "2026-12-25", { ownHours: true });
    await dated(f, row.id);
    await suite.db.update(departments).set({ active: false }).where(eq(departments.id, f.other));
    expect((await read(f, "2026-12-25")).days[0]).toMatchObject({
      tone: "working_day",
      closed: true,
      ownHours: true,
    });
    expect((await read(f, "2026-12-26")).days[0]).toMatchObject({
      tone: "standard",
      namedDay: null,
      closed: false,
    });
    await suite.db
      .update(departments)
      .set({ active: false })
      .where(eq(departments.id, f.department));
    expect((await read(f, "2026-12-26")).days[0]).toMatchObject({ tone: "closed", closed: true });
  });
});

it("reports retained station hours on a one-off day in both Calendar and Opening hours", async () => {
  const f = await fixture();
  const row = await day(f, "2026-12-25");
  await run(async (tx) => {
    const [station] = await tx
      .insert(kitchenStations)
      .values({ locationId: f.cfg.locationId, name: "Kitchen", isDefault: true })
      .returning();
    await tx
      .insert(specialDateHours)
      .values({ specialDateId: row.id, stationId: station!.id, mode: "closed" });
  });
  const model = await run((tx) =>
    namedDayReads.readNamedDaysModel(tx, f.cfg, "2026-12-25", "2026-12-25", now),
  );
  expect(model.days[0]!.namedDay!.hasStationHours).toBe(true);
  expect(
    (await run((tx) => readOpeningHoursModel(tx, f.cfg, now))).namedDays.find(
      ({ id }) => id === row.id,
    )!.hasStationHours,
  ).toBe(true);
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
    namedDayReads.readNamedDaysModel(tx, f.cfg, "2026-02-02", "2026-02-02", now),
  );
  expect(before.area).toEqual({
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
  const after = await run((tx) =>
    namedDayReads.readNamedDaysModel(tx, f.cfg, "2026-02-02", "2026-02-02", now),
  );
  expect(after.area).toEqual({ ...before.area, required: false, chosen: "tenerife" });
  expect(after.days[0]!.tone).toBe("public_holiday");
  await suite.db
    .update(locations)
    .set({ timeZone: "unreadable" })
    .where(eq(locations.id, f.cfg.locationId));
  expect(
    await run((tx) => namedDayReads.readNamedDaysModel(tx, f.cfg, "2026-02-02", "2026-02-02", now)),
  ).toMatchObject({ civilDate: null, clockReadable: false });
});
