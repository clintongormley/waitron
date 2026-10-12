import type {
  HourPeriod,
  HoursSubject,
  WeekCell,
  WeekDay,
} from "./testing/legacy-station-types.js";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  catalogues,
  kitchenStations,
  locations,
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
import type { SpecialDaysModel } from "./holiday-types.js";
import { readCalendarDays } from "./hours.js";
import { readSpecialDaysModel } from "./named-days.js";
import { saveSpecialDay } from "./special-days.js";
import { locationId } from "@waitron/shared";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import { WEEK_DISPLAY_ORDER } from "./hours-types.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import type { VenueScope } from "./operations.js";
import { VENUE_SERVICE_PERMISSIONS } from "./permissions.js";
import { routingModel } from "./routing-store.js";
import { VENUE_SERVICE_ROUTES } from "./routes.js";
import { specialDayDates, specialDays } from "./schema/seasons.js";
import { departments } from "./schema/service.js";
import { replaceMenuWeek, saveMenuPeriod } from "./menu-timetable.js";
import { setStationToday } from "./station-times.js";

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
    const calendarPeriod = await saveMenuPeriod(
      tx,
      cfg,
      restaurant!.id,
      {
        name: "Open",
        menuId: calendarMenu!.id,
        staffMenuIds: [],
      },
      0,
    );
    await replaceMenuWeek(
      tx,
      cfg,
      restaurant!.id,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [{ periodId: calendarPeriod.id, startsAt: "06:00", endsAt: "06:00" }],
      })),
      new Date(),
      0,
    );
    return {
      cfg: { locationId: locationId(location!.id) },
      departmentIds: { restaurant: restaurant!.id, deli: deli!.id },
      restaurant: { kind: "station" as const, id: restaurantStation!.id },
      deli: { kind: "station" as const, id: deliStation!.id },
      bar: { kind: "station" as const, id: bar!.id },
      kitchen: { kind: "station" as const, id: kitchen!.id },
      otherDepartment: { kind: "station" as const, id: foreignStation!.id },
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
  if (method === "DELETE" && path.startsWith("/special-dates/") && body === undefined)
    body = { expectedClockRevision: 0 };
  const headers: Record<string, string> = {};
  if (cookie !== undefined) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return fx.app.request(`${BASE}${path}`, {
    method,
    headers,
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(
            path.startsWith("/special-dates") &&
              body !== null &&
              typeof body === "object" &&
              !Array.isArray(body)
              ? { expectedClockRevision: 0, ...body }
              : body,
          ),
        }),
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
/** Monday-first, every day Closed unless `cells` names it by weekday. */
const week = (cells: Partial<Record<number, WeekCell>> = {}): WeekDay[] =>
  WEEK_DISPLAY_ORDER.map((weekday) => ({ weekday, cell: cells[weekday] ?? closed }));
const unsetWeek = (): WeekDay[] =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, cell: { mode: "not_set", periods: [] } }));

const venueDates = (fx: Fixture) =>
  db
    .select({ id: specialDays.id, date: specialDayDates.date, name: specialDays.name })
    .from(specialDayDates)
    .innerJoin(specialDays, eq(specialDays.id, specialDayDates.specialDayId))
    .where(eq(specialDayDates.locationId, fx.cfg.locationId))
    .orderBy(asc(specialDayDates.date));

const createDay = (
  fx: Fixture,
  date: string,
  options: {
    name?: string;
    closedAllDay?: boolean;
    repeatsYearly?: boolean;
    paint?: {
      departmentId: string;
      ranges: { periodId: string | null; startsAt: string; endsAt: string }[];
    }[];
    at?: Date;
  } = {},
) =>
  withTransaction(db, (tx) =>
    saveSpecialDay(
      tx,
      fx.cfg,
      null,
      {
        name: options.name ?? "Staff party",
        repeatsYearly: options.repeatsYearly ?? false,
        dates: [{ date, closedAllDay: options.closedAllDay ?? false }],
        paint: (options.paint ?? []).map((entry) => ({ ...entry, date })),
      },
      options.at ?? new Date(),
      0,
    ),
  );

describe("reading Hours", () => {
  it.each([
    { at: "2026-10-12T03:59:59.999Z", businessDay: "2026-10-11" },
    { at: "2026-10-12T04:00:00.000Z", businessDay: "2026-10-12" },
  ])(
    "returns the whole page model for the range to anyone who may view the venue at $at",
    async ({ at, businessDay }) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(at));
      onTestFinished(() => {
        vi.useRealTimers();
      });
      const fx = await fixture();
      const party = await createDay(fx, "2030-10-15");
      const response = await send(
        fx,
        "GET",
        "/named-days?from=2030-10-14&to=2030-10-16",
        fx.supervisor,
      );
      expect(response.status).toBe(200);
      const model = (await response.json()) as SpecialDaysModel;
      expect(model.civilDate).toBe("2026-10-12");
      expect(model).toEqual({
        businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
        clockRevision: 0,
        currentBusinessDay: businessDay,
        pending: null,
        timeZone: "Europe/Madrid",
        dayCutover: "06:00",
        civilDate: "2026-10-12",
        clockReadable: true,
        days: [
          { date: "2030-10-14", specialDay: null, holidays: [], tone: "standard", closed: false },
          {
            date: "2030-10-15",
            specialDay: { id: party.id, name: "Staff party" },
            holidays: [],
            tone: "special_day",
            closed: false,
          },
          { date: "2030-10-16", specialDay: null, holidays: [], tone: "standard", closed: false },
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
        area: {
          readiness: "unsupported_country",
          addressKey: '["",null,""]',
          options: [],
          required: false,
          chosen: null,
        },
        localHolidaysPerYear: 0,
      });
      expect(
        (await send(fx, "GET", "/named-days?from=2030-10-14&to=2030-10-16", fx.manager)).status,
      ).toBe(200);
    },
  );

  it("refuses staff, an absent and an expired session", async () => {
    const fx = await fixture();
    const path = "/named-days?from=2030-10-14&to=2030-10-16";
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
      await refused(await send(fx, "GET", `/named-days${query}`, fx.manager), 400, {
        code: "hours.invalid",
        params: { field },
      });
    // A leap year's whole year is the longest range served.
    expect(
      (await send(fx, "GET", "/named-days?from=2032-01-01&to=2032-12-31", fx.manager)).status,
    ).toBe(200);
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
        0,
      );
      const [menu] = await tx.insert(catalogues).values({ name: randomUUID() }).returning();
      const period = await saveMenuPeriod(
        tx,
        fx.cfg,
        fx.departmentIds.deli,
        {
          name: "Deli",
          menuId: menu!.id,
          staffMenuIds: [],
        },
        0,
      );
      await replaceMenuWeek(
        tx,
        fx.cfg,
        fx.departmentIds.deli,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: weekday === 1 ? [{ periodId: period.id, startsAt: "09:00", endsAt: "17:00" }] : [],
        })),
        new Date(),
        0,
      );
      return period;
    });
    await createDay(fx, "2030-10-14", {
      paint: [
        {
          departmentId: fx.departmentIds.deli,
          ranges: [{ periodId: null, startsAt: "09:00", endsAt: "17:00" }],
        },
      ],
    });
    const model = (await (
      await send(fx, "GET", "/named-days?from=2030-10-14&to=2030-10-15", fx.manager)
    ).json()) as SpecialDaysModel;
    expect(model.days.map((day) => day.closed)).toEqual([true, true]);
    expect(model.days.map((day) => day.tone)).toEqual(["special_day", "closed"]);
    await db
      .update(departments)
      .set({ active: false })
      .where(eq(departments.id, fx.departmentIds.restaurant));
    const deli = await withTransaction(db, (tx) =>
      readCalendarDays(tx, fx.cfg, "2030-10-14", "2030-10-15"),
    );
    expect(deli.map((day) => [day.tone, day.closed])).toEqual([
      ["special_day", true],
      ["closed", true],
    ]);
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
        0,
      ),
    );
    const open = await withTransaction(db, (tx) =>
      readCalendarDays(tx, fx.cfg, "2030-10-14", "2030-10-15"),
    );
    expect(open.map((day) => [day.tone, day.closed])).toEqual([
      ["special_day", true],
      ["standard", false],
    ]);
  });

  it("reads the model in the same number of statements whatever the range and its special dates", async () => {
    const fx = await fixture();
    for (const date of ["2030-11-03", "2030-11-10", "2030-11-17", "2030-11-24"])
      await createDay(fx, date, { name: date, closedAllDay: true });
    const statements = (from: string, to: string) =>
      withTransaction(db, async (tx) => {
        const reads = vi.spyOn(tx, "select");
        const model = await readSpecialDaysModel(tx, fx.cfg, from, to, new Date());
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

  it("limits the Calendar to its requested range", async () => {
    const fx = await fixture();
    /** Sunday 6 October 2030, 12:00 in Madrid. */
    const at = new Date("2030-10-06T10:00:00Z");
    const days: Record<string, string> = {};
    for (const date of ["2030-10-12", "2030-10-15", "2030-10-16"])
      days[date] = (await createDay(fx, date, { name: date, at })).id;
    const read = () =>
      withTransaction(db, (tx) => readSpecialDaysModel(tx, fx.cfg, "2030-10-13", "2030-10-15", at));

    const model = await read();
    expect(model.civilDate).toBe("2030-10-06");
    expect(model.days.map((day) => day.specialDay?.id ?? null)).toEqual([
      null,
      null,
      days["2030-10-15"],
    ]);
    for (const field of ["specialDates", "specialCells", "subjects", "week"])
      expect(model).not.toHaveProperty(field);
    await db
      .update(locations)
      .set({ timeZone: "Mars/Base" })
      .where(eq(locations.id, fx.cfg.locationId));
    const unreadable = await read();
    expect([unreadable.civilDate, unreadable.clockReadable]).toEqual([null, false]);
    expect(unreadable.days).toEqual(model.days);
  });
});

describe("writing Hours", () => {
  it("the retired station week writer answers 404 and keeps special days for every session", async () => {
    const fx = await fixture();
    const bodies = [
      { subject: fx.deli, days: week({ 5: periods(period("18:00", "22:00")) }) },
      { subject: fx.deli, days: unsetWeek() },
      { subject: fx.deli, days: week({ 1: periods(period("12:00", "12:00")) }) },
      { subject: fx.kitchen, days: week() },
      { subject: fx.otherDepartment, days: week() },
      { subject: { kind: "department", id: fx.departmentIds.restaurant }, days: week() },
      {},
    ];
    for (const cookie of [fx.manager, fx.supervisor, fx.staff, fx.expired, undefined]) {
      for (const body of bodies) {
        expect((await send(fx, "PUT", "/hours/week", cookie, body)).status).toBe(404);
        expect(await venueDates(fx)).toEqual([]);
      }
    }
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
    withTransaction(db, (tx) => readSpecialDaysModel(tx, fx.cfg, "2026-10-12", "2026-10-18", at));

  it("moves the civil date with a new time zone, keeping named days without closing stations", async () => {
    const fx = await fixture();
    await createDay(fx, "2026-10-15", { at: new Date("2026-10-01T10:00:00Z") });
    const madrid = await model(fx, AT);
    expect(madrid.civilDate).toBe("2026-10-15");
    expect(await barStatus(fx, AT)).toEqual({ open: true, why: "open" });

    await setClock(fx, { timeZone: "America/New_York" });
    const newYork = await model(fx, AT);
    expect(newYork.civilDate).toBe("2026-10-14");
    expect(newYork.timeZone).toBe("America/New_York");
    expect(await barStatus(fx, AT)).toEqual({ open: true, why: "open" });
    expect(newYork.days).toEqual(madrid.days);
  });

  it("moves which business day a manual closure belongs to with a new cutover", async () => {
    const fx = await fixture();
    /** Thursday 15 October 2026 02:30 in Madrid. */
    const at = new Date("2026-10-15T00:30:00Z");
    expect(await barStatus(fx, at)).toEqual({ open: true, why: "open" });
    await withTransaction(db, (tx) => setStationToday(tx, fx.cfg, fx.bar.id, "closed", at));
    const before = await model(fx, at);
    expect(before.civilDate).toBe("2026-10-15");
    expect(await barStatus(fx, at)).toEqual({ open: false, why: "closed_by_hand" });

    await setClock(fx, { dayCutover: "02:00:00" });
    const after = await model(fx, at);
    expect(await barStatus(fx, at)).toEqual({ open: true, why: "open" });
    expect(after).toEqual({
      ...before,
      dayCutover: "02:00",
      businessDayClock: { ...before.businessDayClock, dayCutover: "02:00" },
      currentBusinessDay: "2026-10-15",
    });
  });
});

describe("station-only Hours request boundary", () => {
  it("the retired department week writer answers 404", async () => {
    const fx = await fixture();
    expect(
      (
        await send(fx, "PUT", "/hours/week", fx.manager, {
          subject: { kind: "department", id: fx.departmentIds.restaurant },
          days: week(),
        })
      ).status,
    ).toBe(404);
  });
});

describe("named-days Calendar route", () => {
  it("returns the venue-scoped model for a venue viewer", async () => {
    const fx = await fixture();
    const day = await createDay(fx, "2030-10-15", { repeatsYearly: true, closedAllDay: true });
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
        specialDay: { id: day.id, name: "Staff party" },
        holidays: [],
        tone: "special_day",
        closed: true,
      },
      { date: "2031-10-16", specialDay: null, holidays: [], tone: "standard", closed: false },
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

describe("retired special-date routes", () => {
  it("answers the unmatched-route 404 to every special-date writer for a manager and leaves a special day as it was", async () => {
    const fx = await fixture();
    const day = await createDay(fx, "2030-10-15", { name: "Staff party" });
    const row = () => db.select().from(specialDays).where(eq(specialDays.id, day.id));
    const before = await row();
    expect(before).toHaveLength(1);
    const body = { date: "2030-10-15", name: "Renamed party", closeWholeVenue: false };
    for (const [method, path, sent] of [
      ["POST", "/special-dates", { ...body, date: "2030-10-16" }],
      ["PUT", `/special-dates/${day.id}`, body],
      ["POST", `/special-dates/${day.id}/duplicate`, { dates: ["2030-10-17"] }],
      ["DELETE", `/special-dates/${day.id}`, undefined],
    ] as const) {
      const response = await send(fx, method, path, fx.manager, sent);
      expect({ method, path, status: response.status, body: await response.text() }).toEqual({
        method,
        path,
        status: 404,
        body: "404 Not Found",
      });
      expect(await row()).toEqual(before);
    }
    expect(await venueDates(fx)).toEqual([{ id: day.id, date: "2030-10-15", name: "Staff party" }]);
  });
});

describe("retired station-hours range route", () => {
  it.each([
    "/hours?from=2030-10-14&to=2030-10-16",
    "/hours",
    "/hours?from=2030-02-30&to=2030-03-02",
  ])("answers 404 for %s without changing saved data for any session", async (path) => {
    const fx = await fixture();
    await createDay(fx, "2030-10-15", { closedAllDay: true });
    const beforeDates = await venueDates(fx);
    for (const cookie of [fx.manager, fx.supervisor, fx.staff, fx.expired, undefined]) {
      expect((await send(fx, "GET", path, cookie)).status).toBe(404);
      expect(await venueDates(fx)).toEqual(beforeDates);
    }
  });
});
