import { rangeDates } from "./hours-rules.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { seedBusinessDay, seedActivityActor } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import { seedVenueSettings } from "@waitron/db/testing/seed.js";
import type {
  HourPeriod,
  HoursSubject,
  WeekCell,
  WeekDay,
} from "./testing/legacy-station-types.js";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  catalogues,
  departments,
  kitchenStations,
  locations,
  specialDayDates,
  specialDays,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashPin,
  hashSessionToken,
  managementSessions,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import { calendarDays } from "./hours.js";
import { readOpeningHoursYear } from "./opening-hours-calendar.js";
import { saveSpecialDay } from "./special-days.js";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import { WEEK_DISPLAY_ORDER } from "./hours-types.js";
import { VENUE_SERVICE_PERMISSIONS } from "./permissions.js";
import { routingModel } from "./routing-store.js";
import { VENUE_SERVICE_ROUTES } from "./routes.js";
import { replaceMenuWeek, saveMenuPeriod } from "./menu-timetable.js";
import { setStationToday } from "./station-times.js";

registerModulePermissions(VENUE_SERVICE_PERMISSIONS);

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const BASE = "/management-api/venue-service";
const noopLog: Logger = () => {};

interface Fixture {
  app: Hono;
  cfg: { locationId: string };
  restaurant: HoursSubject;
  deli: HoursSubject;
  bar: HoursSubject;
  kitchen: HoursSubject;
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
    const {
      name: venueName,
      invoiceLocales,
      operationDescription,
      timeZone,
      dayCutover,
      ...columns
    } = venue("Venue");
    const [location] = await tx.insert(locations).values(columns).returning();
    await seedVenueSettings(tx, { name: venueName, invoiceLocales, operationDescription });
    await seedBusinessDay(tx, { timeZone, dayCutover });
    const department = (location: string, name: string, isDefault = false) => ({
      locationId: location,
      name,
      tradingName: `${name} trading`,
      isDefault,
    });
    const [restaurant, deli] = await tx
      .insert(departments)
      .values([department(location!.id, "Restaurant", true), department(location!.id, "Deli")])
      .returning();
    const [bar, kitchen] = await tx
      .insert(kitchenStations)
      .values([{ name: "Bar" }, { name: "Kitchen", isDefault: true }])
      .returning();
    const person = async (role: "manager" | "supervisor" | "staff") => {
      const [row] = await seedPersons(tx, {
        displayName: `${role} ${randomUUID()}`,
        pinHash: hashPin("1234"),
        role,
      });
      return (await startManagementSession(tx, { personId: row!.id })).token;
    };
    const [restaurantStation, deliStation] = await tx
      .insert(kitchenStations)
      .values([{ name: "Pass" }, { name: "Grill" }])
      .returning();
    const [calendarMenu] = await tx
      .insert(catalogues)
      .values({ name: `Calendar ${randomUUID()}` })
      .returning();
    const calendarPeriod = await saveMenuPeriod(tx, restaurant!.id, {
      name: "Open",
      menuId: calendarMenu!.id,
      staffMenuIds: [],
    });
    await replaceMenuWeek(
      tx,
      restaurant!.id,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [{ periodId: calendarPeriod.id, startsAt: "06:00", endsAt: "06:00" }],
      })),
      new Date(),
      1,
    );
    return {
      cfg: { locationId: location!.id },
      departmentIds: { restaurant: restaurant!.id, deli: deli!.id },
      restaurant: { kind: "station" as const, id: restaurantStation!.id },
      deli: { kind: "station" as const, id: deliStation!.id },
      bar: { kind: "station" as const, id: bar!.id },
      kitchen: { kind: "station" as const, id: kitchen!.id },
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
  VENUE_SERVICE_ROUTES.mount(app, { db, cfg: {}, core: {} as ModuleRouteContext["core"] }, noopLog);
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
    body = { expectedClockRevision: 1 };
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
              ? { expectedClockRevision: 1, ...body }
              : body,
          ),
        }),
  });
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

const venueDates = () =>
  db
    .select({ id: specialDays.id, date: specialDayDates.date, name: specialDays.name })
    .from(specialDayDates)
    .innerJoin(specialDays, eq(specialDays.id, specialDayDates.specialDayId))

    .orderBy(asc(specialDayDates.date));

const createDay = (
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
      null,
      {
        name: options.name ?? "Staff party",
        repeatsYearly: options.repeatsYearly ?? false,
        dates: [{ date, closedAllDay: options.closedAllDay ?? false }],
        paint: (options.paint ?? []).map((entry) => ({ ...entry, date })),
      },
      options.at ?? new Date(),
      1,
    ),
  );

describe("reading Hours", () => {
  it("colours a date Closed only when no active department has service ranges", async () => {
    const fx = await fixture();
    const deliPeriod = await withTransaction(db, async (tx) => {
      await replaceMenuWeek(
        tx,
        fx.departmentIds.restaurant,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: [] })),
        new Date(),
        1,
      );
      const [menu] = await tx.insert(catalogues).values({ name: randomUUID() }).returning();
      const period = await saveMenuPeriod(tx, fx.departmentIds.deli, {
        name: "Deli",
        menuId: menu!.id,
        staffMenuIds: [],
      });
      await replaceMenuWeek(
        tx,
        fx.departmentIds.deli,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: weekday === 1 ? [{ periodId: period.id, startsAt: "09:00", endsAt: "17:00" }] : [],
        })),
        new Date(),
        1,
      );
      return period;
    });
    await createDay("2030-10-14", {
      paint: [
        {
          departmentId: fx.departmentIds.deli,
          ranges: [{ periodId: null, startsAt: "09:00", endsAt: "17:00" }],
        },
      ],
    });
    const model = await withTransaction(db, (tx) =>
      calendarDays(tx, rangeDates("2030-10-14", "2030-10-15"), []).then(({ days }) => days),
    );
    expect(model.map((day) => day.closed)).toEqual([true, true]);
    expect(model.map((day) => day.tone)).toEqual(["special_day", "closed"]);
    await db
      .update(departments)
      .set({ active: false })
      .where(eq(departments.id, fx.departmentIds.restaurant));
    const deli = await withTransaction(db, (tx) =>
      calendarDays(tx, rangeDates("2030-10-14", "2030-10-15"), []).then(({ days }) => days),
    );
    expect(deli.map((day) => [day.tone, day.closed])).toEqual([
      ["special_day", true],
      ["closed", true],
    ]);
    await withTransaction(db, (tx) =>
      replaceMenuWeek(
        tx,
        fx.departmentIds.deli,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots:
            weekday === 2 ? [{ periodId: deliPeriod.id, startsAt: "09:00", endsAt: "17:00" }] : [],
        })),
        new Date(),
        1,
      ),
    );
    const open = await withTransaction(db, (tx) =>
      calendarDays(tx, rangeDates("2030-10-14", "2030-10-15"), []).then(({ days }) => days),
    );
    expect(open.map((day) => [day.tone, day.closed])).toEqual([
      ["special_day", true],
      ["standard", false],
    ]);
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
      { subject: { kind: "department", id: fx.departmentIds.restaurant }, days: week() },
      {},
    ];
    for (const cookie of [fx.manager, fx.supervisor, fx.staff, fx.expired, undefined]) {
      for (const body of bodies) {
        expect((await send(fx, "PUT", "/hours/week", cookie, body)).status).toBe(404);
        expect(await venueDates()).toEqual([]);
      }
    }
  });
});

describe("Hours when the venue's clock changes", () => {
  /** Thursday 15 October 2026 01:30 in Madrid; Wednesday 14 October 19:30 in New York. */
  const AT = new Date("2026-10-14T23:30:00Z");

  const setClock = async (_fx: Fixture, clock: { timeZone?: string; dayCutover?: string }) => {
    if (clock.timeZone !== undefined)
      await db.run(
        sql`update settings set doc = json_set(doc, '$.timeZone', ${clock.timeZone}) where module = 'business_day'`,
      );
    if (clock.dayCutover !== undefined) await seedBusinessDay(db, { dayCutover: clock.dayCutover });
  };

  const barStatus = (fx: Fixture, at: Date) =>
    withTransaction(db, async (tx) => {
      const model = await routingModel(tx, at);
      return model.stationTimes.find((times) => times.stationId === fx.bar.id)!.status;
    });

  const model = (at: Date) => withTransaction(db, (tx) => readOpeningHoursYear(tx, 2026, at));

  it("moves the civil date with a new time zone, keeping special days without closing stations", async () => {
    const fx = await fixture();
    await createDay("2026-10-15", { at: new Date("2026-10-01T10:00:00Z") });
    const madrid = await model(AT);
    expect(madrid.today).toBe("2026-10-15");
    expect(await barStatus(fx, AT)).toEqual({ open: true, why: "open" });

    await setClock(fx, { timeZone: "America/New_York" });
    const newYork = await model(AT);
    expect(newYork.today).toBe("2026-10-14");
    expect(newYork.timeZone).toBe("America/New_York");
    expect(await barStatus(fx, AT)).toEqual({ open: true, why: "open" });
    expect(newYork.days).toEqual(madrid.days);
  });

  it("moves which business day a manual closure belongs to with a new cutover", async () => {
    const fx = await fixture();
    /** Thursday 15 October 2026 02:30 in Madrid. */
    const at = new Date("2026-10-15T00:30:00Z");
    expect(await barStatus(fx, at)).toEqual({ open: true, why: "open" });
    await withTransaction(db, async (tx) =>
      setStationToday(tx, fx.bar.id, "closed", at, await seedActivityActor(tx)),
    );
    const before = await model(at);
    expect(before.today).toBe("2026-10-15");
    expect(await barStatus(fx, at)).toEqual({ open: false, why: "closed_by_hand" });

    await setClock(fx, { dayCutover: "02:00:00" });
    const after = await model(at);
    expect(await barStatus(fx, at)).toEqual({ open: true, why: "open" });
    expect(after).toEqual({
      ...before,
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

describe("retired special-date routes", () => {
  it("answers the unmatched-route 404 to every special-date writer for a manager and leaves a special day as it was", async () => {
    const fx = await fixture();
    const day = await createDay("2030-10-15", { name: "Staff party" });
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
    expect(await venueDates()).toEqual([{ id: day.id, date: "2030-10-15", name: "Staff party" }]);
  });
});

describe("retired station-hours range route", () => {
  it.each([
    "/hours?from=2030-10-14&to=2030-10-16",
    "/hours",
    "/hours?from=2030-02-30&to=2030-03-02",
  ])("answers 404 for %s without changing saved data for any session", async (path) => {
    const fx = await fixture();
    await createDay("2030-10-15", { closedAllDay: true });
    const beforeDates = await venueDates();
    for (const cookie of [fx.manager, fx.supervisor, fx.staff, fx.expired, undefined]) {
      expect((await send(fx, "GET", path, cookie)).status).toBe(404);
      expect(await venueDates()).toEqual(beforeDates);
    }
  });
});
