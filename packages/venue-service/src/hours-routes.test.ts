import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  catalogues,
  kitchenStations,
  locations,
  tenants,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashPin,
  hashSessionToken,
  IDENTITY_MIGRATIONS,
  managementSessions,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import { civilDateOf } from "@waitron/reporting";
import { AppError, locationId } from "@waitron/shared";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import {
  readHoursModel,
  readSpecialDate,
  readWeekHours,
  replaceWeekHours,
  saveSpecialDate,
  type SpecialDateParticipant,
} from "./hours.js";
import {
  WEEK_DISPLAY_ORDER,
  type DateCell,
  type HourPeriod,
  type HoursModel,
  type HoursSubject,
  type SpecialDate,
  type SpecialDateInput,
  type WeekCell,
  type WeekDay,
} from "./hours-types.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import type { VenueScope } from "./operations.js";
import { VENUE_SERVICE_PERMISSIONS } from "./permissions.js";
import { routingModel } from "./routing-store.js";
import { VENUE_SERVICE_ROUTES } from "./routes.js";
import { specialDateHours, specialDates } from "./schema/hours.js";
import { departments } from "./schema/service.js";
import { replaceMenuWeek, saveMenuPeriod, saveSpecialDateMenus } from "./menu-timetable.js";
import { setStationToday } from "./station-times.js";
import { clockChangeAfter, minutesAfter } from "./testing/clock-change.js";

const participants = vi.hoisted(() => [] as SpecialDateParticipant[]);
vi.mock("./calendar-participants.js", () => ({
  VENUE_SERVICE_CALENDAR_PARTICIPANTS: participants,
}));

registerModulePermissions(VENUE_SERVICE_PERMISSIONS);

const suite = useVenueDb({
  migrations: [
    CORE_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
  ],
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});
afterEach(() => {
  participants.splice(0);
});

const BASE = "/management-api/venue-service";
const noopLog: Logger = () => {};

interface Fixture {
  app: Hono;
  cfg: VenueScope;
  restaurant: HoursSubject;
  deli: HoursSubject;
  bar: HoursSubject;
  kitchen: HoursSubject;
  otherDepartment: HoursSubject;
  departmentIds: { restaurant: string; deli: string };
  otherDateId: string;
  manager: string;
  supervisor: string;
  staff: string;
  expired: string;
}

async function fixture(): Promise<Fixture> {
  const made = await withTransaction(db, async (tx) => {
    const venue = (name: string) => ({
      name: `${name} ${randomUUID()}`,
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
    });
    const [location] = await tx.insert(locations).values(venue("Venue")).returning();
    const [other] = await tx.insert(locations).values(venue("Other")).returning();
    const department = (location: string, name: string, isDefault = false) => ({
      locationId: location,
      name,
      tradingName: `${name} trading`,
      defaultServiceMode: "table_tab",
      isDefault,
    });
    const [restaurant, deli] = await tx
      .insert(departments)
      .values([
        department(location!.id, "Restaurant", true),
        department(location!.id, "Deli"),
        department(other!.id, "Other restaurant", true),
      ])
      .returning();
    const [bar, kitchen] = await tx
      .insert(kitchenStations)
      .values([
        { locationId: location!.id, name: "Bar", displayOrder: 1 },
        { locationId: location!.id, name: "Kitchen", isDefault: true, displayOrder: 0 },
      ])
      .returning();
    const otherDate = await saveSpecialDate(
      tx,
      { locationId: locationId(other!.id) },
      null,
      { date: "2030-10-15", name: "Elsewhere", closeWholeVenue: false, cells: [] },
      new Date(),
    );
    const person = async (role: "manager" | "supervisor" | "staff") => {
      const [row] = await tx
        .insert(persons)
        .values({ displayName: `${role} ${randomUUID()}`, pinHash: hashPin("1234"), role })
        .returning({ id: persons.id });
      return (await startManagementSession(tx, { personId: row!.id })).token;
    };
    const cfg = { locationId: locationId(location!.id) };
    const [restaurantStation, deliStation, foreignStation] = await tx
      .insert(kitchenStations)
      .values([
        { locationId: location!.id, name: "Pass", displayOrder: 2 },
        { locationId: location!.id, name: "Grill", displayOrder: 3 },
        { locationId: other!.id, name: "Other pass" },
      ])
      .returning();
    const [calendarMenu] = await tx
      .insert(catalogues)
      .values({ name: `Calendar ${randomUUID()}` })
      .returning();
    const calendarPeriod = await saveMenuPeriod(tx, cfg, restaurant!.id, {
      name: "Open",
      menuId: calendarMenu!.id,
      staffMenuIds: [],
    });
    await replaceMenuWeek(
      tx,
      cfg,
      restaurant!.id,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [{ periodId: calendarPeriod.id, startsAt: "06:00", endsAt: "06:00" }],
      })),
      new Date(),
    );
    return {
      cfg: { locationId: locationId(location!.id) },
      departmentIds: { restaurant: restaurant!.id, deli: deli!.id },
      restaurant: { kind: "station" as const, id: restaurantStation!.id },
      deli: { kind: "station" as const, id: deliStation!.id },
      bar: { kind: "station" as const, id: bar!.id },
      kitchen: { kind: "station" as const, id: kitchen!.id },
      otherDepartment: { kind: "station" as const, id: foreignStation!.id },
      otherDateId: otherDate.id,
      manager: await person("manager"),
      supervisor: await person("supervisor"),
      staff: await person("staff"),
      expired: await person("manager"),
    };
  });
  await db
    .update(managementSessions)
    .set({ lastSeenAt: "2000-01-01T00:00:00.000Z" })
    .where(eq(managementSessions.tokenHash, hashSessionToken(made.expired)));
  const app = new Hono();
  VENUE_SERVICE_ROUTES.mount(
    app,
    { db, cfg: made.cfg, core: {} as ModuleRouteContext["core"] },
    noopLog,
  );
  const cookie = (token: string) => `${MANAGEMENT_COOKIE}=${token}`;
  return {
    ...made,
    app,
    manager: cookie(made.manager),
    supervisor: cookie(made.supervisor),
    staff: cookie(made.staff),
    expired: cookie(made.expired),
  };
}

async function send(
  fx: Fixture,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  cookie: string | undefined,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return fx.app.request(`${BASE}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function refused(response: Response, status: number, error: Record<string, unknown>) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error });
}

const period = (opensAt: string, closesAt: string, id = randomUUID()): HourPeriod => ({
  id,
  opensAt,
  closesAt,
});
const closed: WeekCell = { mode: "closed", periods: [] };
const periods = (...list: HourPeriod[]): WeekCell => ({ mode: "periods", periods: list });
const datePeriods = (...list: HourPeriod[]): DateCell => ({ mode: "periods", periods: list });
/** Monday-first, every day Closed unless `cells` names it by weekday. */
const week = (cells: Partial<Record<number, WeekCell>> = {}): WeekDay[] =>
  WEEK_DISPLAY_ORDER.map((weekday) => ({ weekday, cell: cells[weekday] ?? closed }));
const unsetWeek = (): WeekDay[] =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, cell: { mode: "not_set", periods: [] } }));

const input = (overrides: Partial<SpecialDateInput> = {}): SpecialDateInput => ({
  date: "2030-10-15",
  name: "Staff party",
  closeWholeVenue: false,
  cells: [],
  ...overrides,
});

const venueDates = (fx: Fixture) =>
  db
    .select({ id: specialDates.id, date: specialDates.date, name: specialDates.name })
    .from(specialDates)
    .where(eq(specialDates.locationId, fx.cfg.locationId))
    .orderBy(asc(specialDates.date));

const storedWeek = (fx: Fixture, subject: HoursSubject) =>
  withTransaction(db, (tx) => readWeekHours(tx, fx.cfg, subject));

const createDate = (fx: Fixture, value: SpecialDateInput) =>
  withTransaction(db, (tx) => saveSpecialDate(tx, fx.cfg, null, value, new Date()));

describe("reading Hours", () => {
  it("returns the whole page model for the range to anyone who may view the venue", async () => {
    const fx = await fixture();
    const lunch = period("12:00", "16:00");
    await withTransaction(db, (tx) =>
      replaceWeekHours(tx, fx.cfg, fx.bar, week({ 2: periods(lunch) }), new Date()),
    );
    const party = await createDate(
      fx,
      input({ cells: [{ subject: fx.bar, cell: { mode: "closed", periods: [] } }] }),
    );
    const before = civilDateOf(new Date(), "Europe/Madrid");
    const response = await send(fx, "GET", "/hours?from=2030-10-14&to=2030-10-16", fx.supervisor);
    const after = civilDateOf(new Date(), "Europe/Madrid");
    expect(response.status).toBe(200);
    const model = (await response.json()) as HoursModel;
    expect([before, after]).toContain(model.civilDate);
    const unset = unsetWeek();
    expect(model).toEqual({
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
      civilDate: model.civilDate,
      clockReadable: true,
      departments: [
        { id: fx.departmentIds.restaurant, name: "Restaurant" },
        { id: fx.departmentIds.deli, name: "Deli" },
      ],
      subjects: [
        { ...fx.kitchen, name: "Kitchen", active: true, isDefault: true },
        { ...fx.bar, name: "Bar", active: true, isDefault: false },
        { ...fx.restaurant, name: "Pass", active: true, isDefault: false },
        { ...fx.deli, name: "Grill", active: true, isDefault: false },
      ],
      week: [
        { subject: fx.kitchen, days: unset },
        {
          subject: fx.bar,
          days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
            weekday,
            cell: weekday === 2 ? periods(lunch) : closed,
          })),
        },
        { subject: fx.restaurant, days: unset },
        { subject: fx.deli, days: unset },
      ],
      days: [
        { date: "2030-10-14", specialDate: null, holidays: [], tone: "standard" },
        {
          date: "2030-10-15",
          specialDate: {
            kind: "working_day",
            repeats: false,
            ownHours: false,
            id: party.id,
            date: "2030-10-15",
            name: "Staff party",
            closeWholeVenue: false,
          },
          holidays: [],
          tone: "blue",
        },
        { date: "2030-10-16", specialDate: null, holidays: [], tone: "standard" },
      ],
      specialDates: [
        {
          kind: "working_day",
          repeats: false,
          ownHours: false,
          id: party.id,
          date: "2030-10-15",
          name: "Staff party",
          closeWholeVenue: false,
        },
      ],
      specialCells: [
        {
          specialDateId: party.id,
          cells: [{ subject: fx.bar, cell: { mode: "closed", periods: [] } }],
        },
      ],
      // No tenant row is stored here, so there is no country to read holidays for.
      holidayCoverage: [
        {
          year: 2030,
          country: "",
          provinceCode: null,
          regionCode: null,
          nationalRegional: "unsupported_country",
          local: "address_unresolved",
          dataVersion: null,
          sourceIds: [],
        },
      ],
      holidaySources: [],
    });
    expect((await send(fx, "GET", "/hours?from=2030-10-14&to=2030-10-16", fx.manager)).status).toBe(
      200,
    );
  });

  it("refuses staff, an absent and an expired session", async () => {
    const fx = await fixture();
    const path = "/hours?from=2030-10-14&to=2030-10-16";
    await refused(await send(fx, "GET", path, fx.staff), 403, {
      code: "authorization.not_permitted",
    });
    await refused(await send(fx, "GET", path, undefined), 401, {
      code: "management_session.required",
    });
    await refused(await send(fx, "GET", path, fx.expired), 401, {
      code: "management_session.expired",
    });
  });

  it("refuses a missing, impossible, reversed or over-long range, naming the field", async () => {
    const fx = await fixture();
    for (const [query, field] of [
      ["", "from"],
      ["?from=2030-10-14", "to"],
      ["?from=2030-02-30&to=2030-03-02", "from"],
      ["?from=2030-10-14&to=2030-13-01", "to"],
      ["?from=2030-10-14&to=2030-10-13", "to"],
      ["?from=2030-01-01&to=2031-01-02", "to"],
    ] as const)
      await refused(await send(fx, "GET", `/hours${query}`, fx.manager), 400, {
        code: "hours.invalid",
        params: { field },
      });
    // A leap year's whole year is the longest range served.
    expect((await send(fx, "GET", "/hours?from=2032-01-01&to=2032-12-31", fx.manager)).status).toBe(
      200,
    );
  });

  it("colours a date Closed only when no active department has service ranges", async () => {
    const fx = await fixture();
    const deliPeriod = await withTransaction(db, async (tx) => {
      await replaceMenuWeek(
        tx,
        fx.cfg,
        fx.departmentIds.restaurant,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: [] })),
        new Date(),
      );
      const [menu] = await tx.insert(catalogues).values({ name: randomUUID() }).returning();
      const period = await saveMenuPeriod(tx, fx.cfg, fx.departmentIds.deli, {
        name: "Deli",
        menuId: menu!.id,
        staffMenuIds: [],
      });
      await replaceMenuWeek(
        tx,
        fx.cfg,
        fx.departmentIds.deli,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: weekday === 1 ? [{ periodId: period.id, startsAt: "09:00", endsAt: "17:00" }] : [],
        })),
        new Date(),
      );
      return period;
    });
    const special = await createDate(fx, input({ date: "2030-10-14", cells: [] }));
    await db.update(specialDates).set({ ownHours: true }).where(eq(specialDates.id, special.id));
    await withTransaction(db, (tx) =>
      saveSpecialDateMenus(tx, fx.cfg, special.id, fx.departmentIds.deli, [], new Date()),
    );
    const model = (await (
      await send(fx, "GET", "/hours?from=2030-10-14&to=2030-10-15", fx.manager)
    ).json()) as HoursModel;
    expect(model.days.map((day) => day.tone)).toEqual(["closed", "closed"]);
    await db
      .update(departments)
      .set({ active: false })
      .where(eq(departments.id, fx.departmentIds.restaurant));
    const deli = await withTransaction(db, (tx) =>
      readHoursModel(tx, fx.cfg, "2030-10-14", "2030-10-15", new Date()),
    );
    expect(deli.days.map((day) => day.tone)).toEqual(["closed", "closed"]);
    await withTransaction(db, (tx) =>
      replaceMenuWeek(
        tx,
        fx.cfg,
        fx.departmentIds.deli,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots:
            weekday === 2 ? [{ periodId: deliPeriod.id, startsAt: "09:00", endsAt: "17:00" }] : [],
        })),
        new Date(),
      ),
    );
    const open = await withTransaction(db, (tx) =>
      readHoursModel(tx, fx.cfg, "2030-10-14", "2030-10-15", new Date()),
    );
    expect(open.days.map((day) => day.tone)).toEqual(["closed", "standard"]);
  });

  it("reads the model in the same number of statements whatever the range and its special dates", async () => {
    const fx = await fixture();
    await withTransaction(db, (tx) =>
      replaceWeekHours(
        tx,
        fx.cfg,
        fx.restaurant,
        week({ 1: periods(period("09:00", "17:00")) }),
        new Date(),
      ),
    );
    for (const date of ["2030-11-03", "2030-11-10", "2030-11-17", "2030-11-24"])
      await createDate(
        fx,
        input({ date, cells: [{ subject: fx.deli, cell: { mode: "closed", periods: [] } }] }),
      );
    const statements = (from: string, to: string) =>
      withTransaction(db, async (tx) => {
        const reads = vi.spyOn(tx, "select");
        const model = await readHoursModel(tx, fx.cfg, from, to, new Date());
        const count = reads.mock.calls.length;
        reads.mockRestore();
        return { count, days: model.days.length };
      });
    const short = await statements("2030-11-02", "2030-11-04");
    const long = await statements("2030-10-01", "2030-12-31");
    expect(short.days).toBe(3);
    expect(long.days).toBe(92);
    expect(long.count).toBe(short.count);
  });

  it("lists every special date from the venue's yesterday onward however far ahead, apart from the calendar's range", async () => {
    const fx = await fixture();
    /** Sunday 6 October 2030, 12:00 in Madrid. */
    const at = new Date("2030-10-06T10:00:00Z");
    const closedBar = [{ subject: fx.bar, cell: { mode: "closed", periods: [] } as DateCell }];
    const saved: Record<string, SpecialDate> = {};
    for (const date of ["2030-10-04", "2030-10-05", "2030-10-14", "2032-12-25"])
      saved[date] = await withTransaction(db, (tx) =>
        saveSpecialDate(tx, fx.cfg, null, input({ date, name: date, cells: closedBar }), at),
      );
    const read = () =>
      withTransaction(db, (tx) => readHoursModel(tx, fx.cfg, "2030-10-13", "2030-10-15", at));

    const model = await read();
    expect(model.civilDate).toBe("2030-10-06");
    expect(model.specialDates).toEqual([
      saved["2030-10-05"],
      saved["2030-10-14"],
      saved["2032-12-25"],
    ]);
    expect(model.days.map((day) => day.specialDate?.id ?? null)).toEqual([
      null,
      saved["2030-10-14"]!.id,
      null,
    ]);
    for (const date of ["2030-10-05", "2030-10-14", "2032-12-25"])
      expect(
        model.specialCells.find((entry) => entry.specialDateId === saved[date]!.id)?.cells,
      ).toEqual(closedBar);
    expect(
      model.specialCells.some((entry) => entry.specialDateId === saved["2030-10-04"]!.id),
    ).toBe(false);

    // With no venue date to go by, the list starts where the range does.
    await db
      .update(locations)
      .set({ timeZone: "Mars/Base" })
      .where(eq(locations.id, fx.cfg.locationId));
    expect((await read()).specialDates).toEqual([saved["2030-10-14"], saved["2032-12-25"]]);
  });
});

describe("writing Hours", () => {
  it("replaces a subject's standard week, then clears it", async () => {
    const fx = await fixture();
    const dinner = period("19:00", "23:00");
    const saved = await send(fx, "PUT", "/hours/week", fx.manager, {
      subject: fx.deli,
      days: week({ 5: periods(dinner) }),
    });
    expect(saved.status).toBe(204);
    expect((await storedWeek(fx, fx.deli))[5]).toEqual({ weekday: 5, cell: periods(dinner) });
    expect(
      (await send(fx, "PUT", "/hours/week", fx.manager, { subject: fx.deli, days: unsetWeek() }))
        .status,
    ).toBe(204);
    expect(await storedWeek(fx, fx.deli)).toEqual(unsetWeek());
  });

  it("creates, edits, duplicates and deletes a special date under one stable id", async () => {
    const fx = await fixture();
    const created = await send(fx, "POST", "/special-dates", fx.manager, input());
    expect(created.status).toBe(201);
    const date = (await created.json()) as SpecialDate;
    expect(date).toEqual({
      kind: "working_day",
      repeats: false,
      ownHours: false,
      id: expect.any(String),
      date: "2030-10-15",
      name: "Staff party",
      closeWholeVenue: false,
    });

    const edited = await send(
      fx,
      "PUT",
      `/special-dates/${date.id}`,
      fx.manager,
      input({
        name: "Team dinner",
        cells: [{ subject: fx.bar, cell: { mode: "all_day", periods: [] } }],
      }),
    );
    expect(edited.status).toBe(200);
    expect(await edited.json()).toEqual({ ...date, name: "Team dinner" });

    const copied = await send(fx, "POST", `/special-dates/${date.id}/duplicate`, fx.manager, {
      dates: ["2030-10-22", "2030-10-29"],
    });
    expect(copied.status).toBe(201);
    const copies = (await copied.json()) as SpecialDate[];
    expect(copies).toEqual([
      { ...date, id: expect.any(String), date: "2030-10-22", name: "Team dinner" },
      { ...date, id: expect.any(String), date: "2030-10-29", name: "Team dinner" },
    ]);
    expect(new Set([date.id, ...copies.map((copy) => copy.id)]).size).toBe(3);
    expect(
      await withTransaction(db, (tx) => readSpecialDate(tx, fx.cfg, copies[1]!.id)),
    ).toMatchObject({ cells: [{ subject: fx.bar, cell: { mode: "all_day", periods: [] } }] });

    const deleted = await send(fx, "DELETE", `/special-dates/${date.id}`, fx.manager);
    expect(deleted.status).toBe(204);
    expect(await venueDates(fx)).toEqual([
      { id: copies[0]!.id, date: "2030-10-22", name: "Team dinner" },
      { id: copies[1]!.id, date: "2030-10-29", name: "Team dinner" },
    ]);
    await refused(await send(fx, "DELETE", `/special-dates/${date.id}`, fx.manager), 404, {
      code: "special_date.not_found",
      params: { specialDateId: date.id },
    });
  });

  it("takes only the target dates when duplicating", async () => {
    const fx = await fixture();
    const source = await createDate(fx, input());
    for (const body of [
      { dates: ["2030-10-22"], name: "Renamed" },
      { dates: ["2030-10-22"], cells: [] },
    ])
      await refused(
        await send(fx, "POST", `/special-dates/${source.id}/duplicate`, fx.manager, body),
        400,
        { code: "management.request_invalid", params: { field: Object.keys(body)[1] } },
      );
    await refused(
      await send(fx, "POST", `/special-dates/${source.id}/duplicate`, fx.manager, {}),
      400,
      { code: "hours.invalid", params: { field: "dates" } },
    );
    expect(await venueDates(fx)).toEqual([
      { id: source.id, date: "2030-10-15", name: "Staff party" },
    ]);
  });

  it("names a copy on a holiday after the holiday, from target dates alone", async () => {
    const fx = await fixture();
    const tenantBefore = await db.select().from(tenants);
    onTestFinished(() =>
      withTransaction(db, async (tx) => {
        await tx.delete(tenants);
        if (tenantBefore.length > 0) await tx.insert(tenants).values(tenantBefore);
      }),
    );
    await withTransaction(db, async (tx) => {
      await tx
        .insert(tenants)
        .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Invented SL" })
        .onConflictDoUpdate({ target: tenants.id, set: { country: "ES" } });
      await tx
        .update(locations)
        .set({ province: "Sevilla", city: "Sevilla" })
        .where(eq(locations.id, fx.cfg.locationId));
    });
    const source = await createDate(fx, input());
    const copied = await send(fx, "POST", `/special-dates/${source.id}/duplicate`, fx.manager, {
      dates: ["2026-12-25", "2030-10-22"],
    });
    expect(copied.status).toBe(201);
    // Spain's 2026 data lists 25 December as "Natividad del Señor", a national holiday.
    expect(((await copied.json()) as SpecialDate[]).map(({ date, name }) => [date, name])).toEqual([
      ["2026-12-25", "Natividad del Señor"],
      ["2030-10-22", "Staff party"],
    ]);
  });

  it("hands every copy and every delete to the module's calendar participants in the request's transaction", async () => {
    const fx = await fixture();
    const source = await createDate(fx, input());
    const calls: string[] = [];
    participants.push({
      async copy(tx, cfg, sourceId, targetId) {
        const [target] = await tx
          .select({ date: specialDates.date })
          .from(specialDates)
          .where(eq(specialDates.id, targetId));
        calls.push(`copy ${cfg.locationId === fx.cfg.locationId} ${sourceId} ${target!.date}`);
      },
      async beforeDelete(_tx, _cfg, id) {
        calls.push(`delete ${id}`);
      },
    });
    const copied = await send(fx, "POST", `/special-dates/${source.id}/duplicate`, fx.manager, {
      dates: ["2030-10-22"],
    });
    expect(copied.status).toBe(201);
    expect((await send(fx, "DELETE", `/special-dates/${source.id}`, fx.manager)).status).toBe(204);
    expect(calls).toEqual([`copy true ${source.id} 2030-10-22`, `delete ${source.id}`]);
  });

  it("hands a date move to the participants in the request's transaction, and rolls it back when one refuses", async () => {
    const fx = await fixture();
    const source = await createDate(fx, input());
    const calls: string[] = [];
    participants.push({
      async copy() {},
      async beforeDelete() {},
      async beforeMove(tx, cfg, id, toDate) {
        const [stored] = await tx
          .select({ date: specialDates.date })
          .from(specialDates)
          .where(eq(specialDates.id, id));
        calls.push(`move ${cfg.locationId === fx.cfg.locationId} ${id} ${stored!.date} ${toDate}`);
        if (toDate === "2030-10-23") throw new Error("menu move refused");
      },
    });
    const moved = await send(fx, "PUT", `/special-dates/${source.id}`, fx.manager, {
      ...input(),
      date: "2030-10-22",
    });
    expect(moved.status).toBe(200);
    // A save that keeps the date is no move.
    const renamed = await send(fx, "PUT", `/special-dates/${source.id}`, fx.manager, {
      ...input(),
      date: "2030-10-22",
      name: "Staff lunch",
    });
    expect(renamed.status).toBe(200);
    const refused = await send(fx, "PUT", `/special-dates/${source.id}`, fx.manager, {
      ...input(),
      date: "2030-10-23",
    });
    expect(refused.status).toBe(500);
    expect(calls).toEqual([
      `move true ${source.id} 2030-10-15 2030-10-22`,
      `move true ${source.id} 2030-10-22 2030-10-23`,
    ]);
    expect(await venueDates(fx)).toEqual([
      { id: source.id, date: "2030-10-22", name: "Staff lunch" },
    ]);
  });

  it("rolls back the whole copy when a participant refuses", async () => {
    const fx = await fixture();
    const source = await createDate(fx, input());
    participants.push({
      async copy() {
        throw new Error("menu copy failed");
      },
      async beforeDelete() {},
    });
    const response = await send(fx, "POST", `/special-dates/${source.id}/duplicate`, fx.manager, {
      dates: ["2030-10-22"],
    });
    expect(response.status).toBe(500);
    expect(await venueDates(fx)).toEqual([
      { id: source.id, date: "2030-10-15", name: "Staff party" },
    ]);
  });
});

describe("Hours write refusals", () => {
  it("refuses a malformed id, another venue's date and an unknown one", async () => {
    const fx = await fixture();
    for (const [method, path, body] of [
      ["PUT", "/special-dates/not-a-uuid", input()],
      ["POST", "/special-dates/not-a-uuid/duplicate", { dates: ["2030-10-22"] }],
      ["DELETE", "/special-dates/not-a-uuid", undefined],
    ] as const)
      await refused(await send(fx, method, path, fx.manager, body), 400, {
        code: "shared.invalid_id",
      });
    for (const id of [fx.otherDateId, randomUUID()])
      for (const [method, path, body] of [
        ["PUT", `/special-dates/${id}`, input({ date: "2030-11-01" })],
        ["POST", `/special-dates/${id}/duplicate`, { dates: ["2030-11-02"] }],
        ["DELETE", `/special-dates/${id}`, undefined],
      ] as const)
        await refused(await send(fx, method, path, fx.manager, body), 404, {
          code: "special_date.not_found",
          params: { specialDateId: id },
        });
    expect(await venueDates(fx)).toEqual([]);
  });

  it("refuses a date another special date already holds", async () => {
    const fx = await fixture();
    const held = await createDate(fx, input());
    const other = await createDate(fx, input({ date: "2030-10-20" }));
    await refused(await send(fx, "POST", "/special-dates", fx.manager, input()), 409, {
      code: "special_date.date_taken",
      params: { date: "2030-10-15" },
    });
    await refused(await send(fx, "PUT", `/special-dates/${other.id}`, fx.manager, input()), 409, {
      code: "special_date.date_taken",
      params: { date: "2030-10-15" },
    });
    await refused(
      await send(fx, "POST", `/special-dates/${other.id}/duplicate`, fx.manager, {
        dates: ["2030-10-25", "2030-10-15"],
      }),
      409,
      { code: "special_date.date_taken", params: { date: "2030-10-15" } },
    );
    expect(await venueDates(fx)).toEqual([
      { id: held.id, date: "2030-10-15", name: "Staff party" },
      { id: other.id, date: "2030-10-20", name: "Staff party" },
    ]);
  });

  it("refuses a bad field, naming it, and keeps what was stored", async () => {
    const fx = await fixture();
    await refused(
      await send(fx, "PUT", "/hours/week", fx.manager, {
        subject: fx.deli,
        days: week({ 1: periods(period("12:00", "12:00")) }),
      }),
      400,
      { code: "hours.invalid", params: { field: "days.0.cell.periods.0.closesAt" } },
    );
    await refused(
      await send(fx, "PUT", "/hours/week", fx.manager, {
        subject: fx.otherDepartment,
        days: week(),
      }),
      400,
      { code: "hours.invalid", params: { field: "subject" } },
    );
    await refused(
      await send(fx, "POST", "/special-dates", fx.manager, input({ name: "  " })),
      400,
      { code: "hours.invalid", params: { field: "name" } },
    );
    expect(await storedWeek(fx, fx.deli)).toEqual(unsetWeek());
    expect(await venueDates(fx)).toEqual([]);
  });

  it("names a duplicate's clash by the neighbouring date and a skipped minute by the target itself", async () => {
    const fx = await fixture();
    // The bar's standard Wednesday opens at 01:00; a copied Tuesday running to 03:00 clashes.
    await withTransaction(db, (tx) =>
      replaceWeekHours(
        tx,
        fx.cfg,
        fx.bar,
        week({ 3: periods(period("01:00", "05:00")) }),
        new Date(),
      ),
    );
    const late = await createDate(
      fx,
      input({
        date: "2030-10-14",
        cells: [{ subject: fx.bar, cell: datePeriods(period("22:00", "03:00")) }],
      }),
    );
    await refused(
      await send(fx, "POST", `/special-dates/${late.id}/duplicate`, fx.manager, {
        dates: ["2030-10-28", "2030-10-22"],
      }),
      400,
      {
        code: "hours.invalid",
        params: { field: "dates.1", date: "2030-10-23", subjectId: fx.bar.id },
      },
    );
    const forward = clockChangeAfter("Europe/Madrid", "2030-01-01T00:00:00Z", "forward");
    const early = await createDate(
      fx,
      input({
        date: "2030-01-07",
        cells: [
          {
            subject: fx.deli,
            cell: datePeriods(
              period(minutesAfter(forward.before, 1), minutesAfter(forward.before, 30)),
            ),
          },
        ],
      }),
    );
    await refused(
      await send(fx, "POST", `/special-dates/${early.id}/duplicate`, fx.manager, {
        dates: [forward.date],
      }),
      400,
      {
        code: "hours.invalid",
        params: { field: "dates.0", date: forward.date, subjectId: fx.deli.id },
      },
    );
    expect(await venueDates(fx)).toEqual([
      { id: early.id, date: "2030-01-07", name: "Staff party" },
      { id: late.id, date: "2030-10-14", name: "Staff party" },
    ]);
  });

  it("refuses a schedule for the default station, which is always open", async () => {
    const fx = await fixture();
    await refused(
      await send(fx, "PUT", "/hours/week", fx.manager, { subject: fx.kitchen, days: week() }),
      409,
      { code: "station.always_open", params: { stationId: fx.kitchen.id } },
    );
    await refused(
      await send(
        fx,
        "POST",
        "/special-dates",
        fx.manager,
        input({ cells: [{ subject: fx.kitchen, cell: { mode: "closed", periods: [] } }] }),
      ),
      409,
      { code: "station.always_open", params: { stationId: fx.kitchen.id } },
    );
    expect(await storedWeek(fx, fx.kitchen)).toEqual(unsetWeek());
    expect(await venueDates(fx)).toEqual([]);
    expect(await db.select().from(specialDateHours)).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ stationId: fx.kitchen.id })]),
    );
  });

  it("lets only a venue service manager write, however the request reaches the server", async () => {
    const fx = await fixture();
    const source = await createDate(fx, input());
    const writes = [
      ["PUT", "/hours/week", { subject: fx.deli, days: week() }],
      ["POST", "/special-dates", input({ date: "2030-11-01" })],
      ["PUT", `/special-dates/${source.id}`, input({ name: "Renamed" })],
      ["POST", `/special-dates/${source.id}/duplicate`, { dates: ["2030-11-02"] }],
      ["DELETE", `/special-dates/${source.id}`, undefined],
    ] as const;
    for (const [method, path, body] of writes) {
      await refused(await send(fx, method, path, fx.supervisor, body), 403, {
        code: "authorization.not_permitted",
      });
      await refused(await send(fx, method, path, fx.staff, body), 403, {
        code: "authorization.not_permitted",
      });
      await refused(await send(fx, method, path, undefined, body), 401, {
        code: "management_session.required",
      });
      await refused(await send(fx, method, path, fx.expired, body), 401, {
        code: "management_session.expired",
      });
    }
    expect(await storedWeek(fx, fx.deli)).toEqual(unsetWeek());
    expect(await venueDates(fx)).toEqual([
      { id: source.id, date: "2030-10-15", name: "Staff party" },
    ]);
  });
});

describe("Hours when the venue's clock changes", () => {
  /** Thursday 15 October 2026 01:30 in Madrid; Wednesday 14 October 19:30 in New York. */
  const AT = new Date("2026-10-14T23:30:00Z");

  const setClock = (fx: Fixture, clock: { timeZone?: string; dayCutover?: string }) =>
    db.update(locations).set(clock).where(eq(locations.id, fx.cfg.locationId));

  const barStatus = (fx: Fixture, at: Date) =>
    withTransaction(db, async (tx) => {
      const model = await routingModel(tx, fx.cfg, at);
      return model.stationTimes.find((times) => times.stationId === fx.bar.id)!.status;
    });

  const model = (fx: Fixture, at: Date) =>
    withTransaction(db, (tx) => readHoursModel(tx, fx.cfg, "2026-10-12", "2026-10-18", at));

  it("moves the civil date and the routing labels with a new time zone, keeping the week and special dates", async () => {
    const fx = await fixture();
    await withTransaction(db, async (tx) => {
      const evenings = Object.fromEntries(
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => [weekday, periods(period("18:00", "23:00"))]),
      );
      await replaceWeekHours(tx, fx.cfg, fx.bar, week(evenings), new Date("2026-10-01T10:00:00Z"));
      await saveSpecialDate(
        tx,
        fx.cfg,
        null,
        input({
          date: "2026-10-15",
          cells: [{ subject: fx.bar, cell: { mode: "closed", periods: [] } }],
        }),
        new Date("2026-10-01T10:00:00Z"),
      );
    });
    const madrid = await model(fx, AT);
    expect(madrid.civilDate).toBe("2026-10-15");
    expect(await barStatus(fx, AT)).toEqual({ open: false, why: "out_of_hours" });

    await setClock(fx, { timeZone: "America/New_York" });
    const newYork = await model(fx, AT);
    expect(newYork.civilDate).toBe("2026-10-14");
    expect(newYork.timeZone).toBe("America/New_York");
    expect(await barStatus(fx, AT)).toEqual({ open: true, why: "in_hours" });
    expect(newYork.week).toEqual(madrid.week);
    expect(newYork.days).toEqual(madrid.days);
    expect(newYork.specialCells).toEqual(madrid.specialCells);
  });

  it("moves which business day a manual closure belongs to with a new cutover, but not which date owns the hours", async () => {
    const fx = await fixture();
    /** Thursday 15 October 2026 02:30 in Madrid. */
    const at = new Date("2026-10-15T00:30:00Z");
    await withTransaction(db, (tx) =>
      replaceWeekHours(
        tx,
        fx.cfg,
        fx.bar,
        week({ 3: closed, 4: { mode: "all_day", periods: [] } }),
        new Date("2026-10-01T10:00:00Z"),
      ),
    );
    // The bar is Closed on Wednesday and open all Thursday. Before the 06:00 cutover the business
    // day is still Wednesday the 14th, but Thursday the 15th owns the hours.
    expect(await barStatus(fx, at)).toEqual({ open: true, why: "in_hours" });
    await withTransaction(db, (tx) => setStationToday(tx, fx.cfg, fx.bar.id, "closed", at));
    const before = await model(fx, at);
    expect(before.civilDate).toBe("2026-10-15");
    expect(await barStatus(fx, at)).toEqual({ open: false, why: "closed_by_hand" });

    await setClock(fx, { dayCutover: "02:00:00" });
    const after = await model(fx, at);
    expect(await barStatus(fx, at)).toEqual({ open: true, why: "in_hours" });
    expect(after).toEqual({ ...before, dayCutover: "02:00" });
  });
});

describe("station-only Hours request boundary", () => {
  it("refuses a department week at subject.kind and keeps the page's station weeks unset", async () => {
    const fx = await fixture();
    await refused(
      await send(fx, "PUT", "/hours/week", fx.manager, {
        subject: { kind: "department" as never, id: fx.departmentIds.restaurant },
        days: week(),
      }),
      400,
      { code: "hours.invalid", params: { field: "subject.kind" } },
    );
    expect(await storedWeek(fx, fx.restaurant)).toEqual(unsetWeek());
  });
  it("refuses a department special-date cell at its kind without creating a named date", async () => {
    const fx = await fixture();
    await refused(
      await send(
        fx,
        "POST",
        "/special-dates",
        fx.manager,
        input({
          cells: [
            {
              subject: { kind: "department" as never, id: fx.departmentIds.restaurant },
              cell: { mode: "closed", periods: [] },
            },
          ],
        }),
      ),
      400,
      { code: "hours.invalid", params: { field: "cells.0.subject.kind" } },
    );
    expect(await venueDates(fx)).toEqual([]);
  });
});

it("rolls back POST date and cells when an after-change participant refuses", async () => {
  const fx = await fixture();
  participants.push({
    async copy() {},
    async beforeDelete() {},
    async afterChange() {
      throw new AppError("hours.invalid", { field: "date" });
    },
  });
  const before = await db.select().from(specialDateHours);
  await refused(await send(fx, "POST", "/special-dates", fx.manager, input()), 400, {
    code: "hours.invalid",
    params: { field: "date" },
  });
  expect(await venueDates(fx)).toEqual([]);
  expect(await db.select().from(specialDateHours)).toEqual(before);
});

describe("named-day HTTP writes", () => {
  it("returns recurring named-day metadata and refuses a later clashing occurrence", async () => {
    const fx = await fixture();
    const created = await send(fx, "POST", "/special-dates", fx.manager, {
      ...input({ date: "2030-12-25" }),
      kind: "holiday",
      repeats: true,
      ownHours: true,
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      date: "2030-12-25",
      kind: "holiday",
      repeats: true,
      ownHours: true,
    });
    await refused(
      await send(fx, "POST", "/special-dates", fx.manager, input({ date: "2031-12-25" })),
      409,
      { code: "special_date.date_taken", params: { date: "2031-12-25" } },
    );
    expect(await venueDates(fx)).toHaveLength(1);
  });
  it.each(["kind", "repeats", "ownHours"])(
    "rejects an explicit null %s with a field refusal",
    async (field) => {
      const fx = await fixture();
      await refused(
        await send(fx, "POST", "/special-dates", fx.manager, { ...input(), [field]: null }),
        400,
        { code: "hours.invalid", params: { field } },
      );
      expect(await venueDates(fx)).toEqual([]);
    },
  );
});

describe("named-days Calendar route", () => {
  it("returns the venue-scoped model for a venue viewer", async () => {
    const fx = await fixture();
    const day = await createDate(
      fx,
      input({ kind: "holiday", repeats: true, closeWholeVenue: true }),
    );
    const response = await send(
      fx,
      "GET",
      "/named-days?from=2031-10-15&to=2031-10-16",
      fx.supervisor,
    );
    expect(response.status).toBe(200);
    const model = await response.json();
    expect(model.days).toEqual([
      {
        date: "2031-10-15",
        namedDay: {
          id: day.id,
          date: "2030-10-15",
          name: "Staff party",
          kind: "holiday",
          repeats: true,
          ownHours: false,
          closeWholeVenue: true,
          hasStationHours: false,
        },
        holidays: [],
        tone: "own_holiday",
        ownHours: false,
        closed: true,
      },
      {
        date: "2031-10-16",
        namedDay: null,
        holidays: [],
        tone: "standard",
        ownHours: false,
        closed: false,
      },
    ]);
  });
  it("requires the existing venue view authorization", async () => {
    const fx = await fixture();
    await refused(
      await send(fx, "GET", "/named-days?from=2030-10-15&to=2030-10-15", fx.staff),
      403,
      { code: "authorization.not_permitted" },
    );
    await refused(
      await send(fx, "GET", "/named-days?from=2030-10-15&to=2030-10-15", undefined),
      401,
      { code: "management_session.required" },
    );
  });
  it("refuses missing, malformed, reversed and overlong ranges", async () => {
    const fx = await fixture();
    for (const [query, field] of [
      ["", "from"],
      ["from=2030-02-30&to=2030-03-01", "from"],
      ["from=2030-10-16&to=2030-10-15", "to"],
      ["from=2030-01-01&to=2031-01-02", "to"],
    ]) {
      await refused(await send(fx, "GET", `/named-days?${query}`, fx.supervisor), 400, {
        code: "hours.invalid",
        params: { field },
      });
    }
  });
});
