import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
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
  kitchenStations,
  locationBusinessDaySettings,
  locations,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashPin,
  IDENTITY_MIGRATIONS,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import { readLocationClock } from "@waitron/reporting";
import { locationId as brandLocationId } from "@waitron/shared";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import { replaceMenuWeek, saveMenuPeriod } from "./menu-timetable.js";
import type { MenuSlot } from "./menu-timetable-types.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { createDepartment } from "./operations.js";
import { VENUE_SERVICE_PERMISSIONS } from "./permissions.js";
import { VENUE_SERVICE_ROUTES } from "./routes.js";
import { menuPeriods } from "./schema/menus.js";
import { periodExtensions } from "./schema/period-extensions.js";
import { routingCellPeriods, routingCells } from "./schema/routing.js";
import {
  departmentDayRanges,
  departmentDays,
  seasons as seasonsTable,
  specialDayDates,
} from "./schema/seasons.js";
import { ensureDefaultSeasons } from "./seasons.js";
import { serviceMomentAt } from "./service-day.js";
import { saveSpecialDay } from "./special-days.js";

registerModulePermissions(VENUE_SERVICE_PERMISSIONS);

const suite = useVenueDb({
  migrations: [
    CORE_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
  ],
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const scoped = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(db, fn);
const BASE = "/management-api/venue-service/menu-periods";
const noopLog: Logger = () => {};
/** A Thursday, which no season paints. */
const FUTURE = "2030-10-17";
const PAST = "2020-10-14";

const slot = (periodId: string, startsAt: string, endsAt: string): MenuSlot => ({
  periodId,
  startsAt,
  endsAt,
});
const hhmm = (time: string) => time.slice(0, 5);

async function routed() {
  const [location] = await db
    .insert(locations)
    .values({
      name: `Casa ${randomUUID()}`,
      invoiceLocales: ["es-ES"],
      operationDescription: "Hostelería",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
    })
    .returning({ id: locations.id });
  const locationId = brandLocationId(location!.id);
  const cfg = { locationId };
  const [station] = await db
    .insert(kitchenStations)
    .values({ locationId, name: "Cocina", isDefault: true })
    .returning({ id: kitchenStations.id });
  const made = await scoped(async (tx) => {
    const seasons = await ensureDefaultSeasons(tx, cfg);
    const season = (name: string) => seasons.find((entry) => entry.name === name)!.id;
    const restaurant = (
      await createDepartment(tx, cfg, { name: "Restaurant", orderStart: "table" })
    ).id;
    const deli = (await createDepartment(tx, cfg, { name: "Deli", orderStart: "counter" })).id;
    const menu = (await createCatalogue(tx, { name: "Carta" })).id;
    const { document } = await buildMenuDocument(tx, menu);
    await publishMenu(tx, menu, menuDocumentHash(document), "person-1");
    const period = async (departmentId: string, name: string) =>
      (await saveMenuPeriod(tx, cfg, departmentId, { name, menuId: menu, staffMenuIds: [] }, 0)).id;
    const dinner = await period(restaurant, "Dinner");
    const lunch = await period(restaurant, "Lunch");
    const afternoon = await period(restaurant, "Afternoon");
    const deliLunch = await period(deli, "Deli lunch");
    const week = (fill: MenuSlot[]) =>
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: weekday === 3 ? fill : [] }));
    for (const name of ["Summer", "Autumn"])
      await replaceMenuWeek(
        tx,
        cfg,
        restaurant,
        week([slot(lunch, "12:00", "16:00"), slot(dinner, "20:00", "23:00")]),
        new Date(),
        0,
        { seasonId: season(name) },
      );
    const specialDay = async (name: string, date: string, paint: MenuSlot[]) =>
      (
        await saveSpecialDay(
          tx,
          cfg,
          null,
          {
            name,
            repeatsYearly: false,
            dates: [{ date, closedAllDay: false }],
            paint: [{ departmentId: restaurant, date, ranges: paint }],
          },
          new Date(),
          0,
        )
      ).id;
    const aniversario = await specialDay("Aniversario", FUTURE, [
      slot(lunch, "13:00", "15:00"),
      slot(afternoon, "15:00", "18:00"),
    ]);
    await specialDay("Fiesta pasada", PAST, [slot(lunch, "13:00", "15:00")]);
    const [cell] = await tx
      .insert(routingCells)
      .values({ locationId, stationId: station!.id, noCategory: true })
      .returning({ id: routingCells.id });
    await tx.insert(routingCellPeriods).values({
      cellId: cell!.id,
      periodId: lunch,
      departmentId: restaurant,
      stationId: station!.id,
    });
    const today = serviceMomentAt(new Date(), await readLocationClock(tx, locationId))!.businessDay;
    await tx.insert(periodExtensions).values({
      departmentId: restaurant,
      businessDay: today,
      periodId: lunch,
      startsAt: "16:00:00",
      endsAt: "17:00:00",
    });
    const person = async (role: "manager" | "supervisor" | "staff") => {
      const [row] = await tx
        .insert(persons)
        .values({ displayName: `${role} ${randomUUID()}`, pinHash: hashPin("1234"), role })
        .returning({ id: persons.id });
      return `${MANAGEMENT_COOKIE}=${(await startManagementSession(tx, { personId: row!.id })).token}`;
    };
    return {
      restaurant,
      deli,
      dinner,
      lunch,
      afternoon,
      deliLunch,
      aniversario,
      today,
      seasons: { summer: season("Summer"), autumn: season("Autumn") },
      manager: await person("manager"),
      supervisor: await person("supervisor"),
      staff: await person("staff"),
    };
  });
  const app = new Hono();
  VENUE_SERVICE_ROUTES.mount(app, { db, cfg, core: {} as ModuleRouteContext["core"] }, noopLog);
  const send = (method: "GET" | "POST", path: string, cookie: string, body?: unknown) =>
    app.request(`${BASE}${path}`, {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { ...made, cfg, locationId, app, send };
}
type Routed = Awaited<ReturnType<typeof routed>>;

/** The four places that name a period, and the restaurant's periods, read by value. */
async function stored(r: Routed) {
  const seasonRanges = await db
    .select({
      season: seasonsTable.name,
      weekday: departmentDays.weekday,
      period: menuPeriods.name,
      startsAt: departmentDayRanges.startsAt,
      endsAt: departmentDayRanges.endsAt,
    })
    .from(departmentDayRanges)
    .innerJoin(departmentDays, eq(departmentDays.id, departmentDayRanges.dayId))
    .innerJoin(seasonsTable, eq(seasonsTable.id, departmentDays.seasonId))
    .innerJoin(menuPeriods, eq(menuPeriods.id, departmentDayRanges.periodId))
    .where(eq(departmentDays.departmentId, r.restaurant))
    .orderBy(
      asc(seasonsTable.startsOn),
      asc(departmentDays.weekday),
      asc(departmentDayRanges.startsAt),
    );
  const specialDayRanges = await db
    .select({
      date: specialDayDates.date,
      period: menuPeriods.name,
      startsAt: departmentDayRanges.startsAt,
      endsAt: departmentDayRanges.endsAt,
    })
    .from(departmentDayRanges)
    .innerJoin(departmentDays, eq(departmentDays.id, departmentDayRanges.dayId))
    .innerJoin(specialDayDates, eq(specialDayDates.id, departmentDays.specialDayDateId))
    .leftJoin(menuPeriods, eq(menuPeriods.id, departmentDayRanges.periodId))
    .where(eq(departmentDays.departmentId, r.restaurant))
    .orderBy(asc(specialDayDates.date), asc(departmentDayRanges.startsAt));
  const routing = await db
    .select({ period: menuPeriods.name })
    .from(routingCellPeriods)
    .innerJoin(routingCells, eq(routingCells.id, routingCellPeriods.cellId))
    .innerJoin(menuPeriods, eq(menuPeriods.id, routingCellPeriods.periodId))
    .where(eq(routingCells.locationId, r.locationId));
  const extensions = await db
    .select({
      businessDay: periodExtensions.businessDay,
      period: menuPeriods.name,
      startsAt: periodExtensions.startsAt,
      endsAt: periodExtensions.endsAt,
    })
    .from(periodExtensions)
    .innerJoin(menuPeriods, eq(menuPeriods.id, periodExtensions.periodId))
    .where(eq(periodExtensions.departmentId, r.restaurant));
  const periods = await db
    .select({ name: menuPeriods.name })
    .from(menuPeriods)
    .where(eq(menuPeriods.departmentId, r.restaurant))
    .orderBy(asc(menuPeriods.name));
  return {
    seasons: seasonRanges.map(
      (row) =>
        `${row.season} ${row.weekday} ${row.period} ${hhmm(row.startsAt)}-${hhmm(row.endsAt)}`,
    ),
    specialDays: specialDayRanges.map(
      (row) => `${row.date} ${row.period ?? "Closed"} ${hhmm(row.startsAt)}-${hhmm(row.endsAt)}`,
    ),
    routing: routing.map((row) => row.period).sort(),
    extensions: extensions.map(
      (row) => `${row.businessDay} ${row.period} ${hhmm(row.startsAt)}-${hhmm(row.endsAt)}`,
    ),
    periods: periods.map((row) => row.name),
  };
}

async function answers(response: Response, status: number, error?: Record<string, unknown>) {
  expect(response.status).toBe(status);
  if (error !== undefined) expect(await response.json()).toEqual({ error });
}

describe("the period-delete routes", () => {
  it("GET painted-in lists every period of the venue by name, with where it is painted, for a venue viewer", async () => {
    const r = await routed();

    const response = await r.send("GET", "/painted-in", r.supervisor);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        periodId: r.afternoon,
        seasons: [],
        specialDays: [{ id: r.aniversario, name: "Aniversario" }],
      },
      { periodId: r.deliLunch, seasons: [], specialDays: [] },
      {
        periodId: r.dinner,
        seasons: [
          { id: r.seasons.summer, name: "Summer" },
          { id: r.seasons.autumn, name: "Autumn" },
        ],
        specialDays: [],
      },
      {
        periodId: r.lunch,
        seasons: [
          { id: r.seasons.summer, name: "Summer" },
          { id: r.seasons.autumn, name: "Autumn" },
        ],
        specialDays: [{ id: r.aniversario, name: "Aniversario" }],
      },
    ]);
  });

  it("GET painted-in with a periodId lists only that period, and refuses a malformed id", async () => {
    const r = await routed();

    const response = await r.send("GET", `/painted-in?periodId=${r.dinner}`, r.supervisor);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        periodId: r.dinner,
        seasons: [
          { id: r.seasons.summer, name: "Summer" },
          { id: r.seasons.autumn, name: "Autumn" },
        ],
        specialDays: [],
      },
    ]);
    await answers(await r.send("GET", "/painted-in?periodId=not-a-uuid", r.manager), 400, {
      code: "shared.invalid_id",
      params: { kind: "MenuPeriodId", value: "not-a-uuid" },
    });
  });

  it("GET delete-impact says what deleting a period would change, for a venue viewer", async () => {
    const r = await routed();

    const response = await r.send("GET", `/${r.lunch}/delete-impact`, r.supervisor);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      seasons: 2,
      specialDays: 1,
      routingUses: [{ rowKind: "no_category", rowLabel: null, zoneName: null }],
      keptOpenToday: true,
      replacements: [
        { id: r.afternoon, name: "Afternoon" },
        { id: r.dinner, name: "Dinner" },
      ],
      clockRevision: 0,
    });
  });

  it("GET delete-impact carries the clock revision POST delete accepts, and a new one once the clock changes", async () => {
    const r = await routed();
    const revision = async () =>
      (
        (await (await r.send("GET", `/${r.lunch}/delete-impact`, r.manager)).json()) as {
          clockRevision: number;
        }
      ).clockRevision;
    const before = await revision();
    await scoped((tx) =>
      tx
        .insert(locationBusinessDaySettings)
        .values({ locationId: r.cfg.locationId, revision: before + 2 }),
    );
    const after = await revision();
    expect(after).toBe(before + 2);

    await answers(
      await r.send("POST", `/${r.lunch}/delete`, r.manager, {
        replacementPeriodId: null,
        expectedClockRevision: before,
      }),
      409,
      { code: "hours.clock_changed", params: {} },
    );
    await answers(
      await r.send("POST", `/${r.lunch}/delete`, r.manager, {
        replacementPeriodId: null,
        expectedClockRevision: after,
      }),
      204,
    );
  });

  it("refuses both reads to someone who may not view the venue", async () => {
    const r = await routed();
    for (const path of ["/painted-in", `/${r.lunch}/delete-impact`])
      await answers(await r.send("GET", path, r.staff), 403, {
        code: "authorization.not_permitted",
        params: { permission: "venue.view" },
      });
  });

  it("GET delete-impact answers menu_period.not_found for a period it does not hold, and refuses a malformed id", async () => {
    const r = await routed();
    const missing = randomUUID();
    await answers(await r.send("GET", `/${missing}/delete-impact`, r.manager), 404, {
      code: "menu_period.not_found",
      params: { periodId: missing },
    });
    await answers(await r.send("GET", "/not-a-uuid/delete-impact", r.manager), 400, {
      code: "shared.invalid_id",
      params: { kind: "MenuPeriodId", value: "not-a-uuid" },
    });
  });

  it("POST delete with a replacement paints and keeps open the replacement instead, deletes the period's routing lines, and answers 204", async () => {
    const r = await routed();

    const response = await r.send("POST", `/${r.lunch}/delete`, r.manager, {
      replacementPeriodId: r.afternoon,
      expectedClockRevision: 0,
    });

    await answers(response, 204);
    expect(await stored(r)).toEqual({
      seasons: [
        "Summer 3 Afternoon 12:00-16:00",
        "Summer 3 Dinner 20:00-23:00",
        "Autumn 3 Afternoon 12:00-16:00",
        "Autumn 3 Dinner 20:00-23:00",
      ],
      specialDays: [`${PAST} Afternoon 13:00-15:00`, `${FUTURE} Afternoon 13:00-18:00`],
      routing: [],
      extensions: [`${r.today} Afternoon 16:00-17:00`],
      periods: ["Afternoon", "Dinner"],
    });
  });

  it("POST delete with an explicit null replacement removes the period's paint, routing and extension", async () => {
    const r = await routed();

    const response = await r.send("POST", `/${r.lunch}/delete`, r.manager, {
      replacementPeriodId: null,
      expectedClockRevision: 0,
    });

    await answers(response, 204);
    expect(await stored(r)).toEqual({
      seasons: ["Summer 3 Dinner 20:00-23:00", "Autumn 3 Dinner 20:00-23:00"],
      specialDays: [`${FUTURE} Afternoon 15:00-18:00`],
      routing: [],
      extensions: [],
      periods: ["Afternoon", "Dinner"],
    });
  });

  it("refuses a viewer the delete, changing nothing", async () => {
    const r = await routed();
    const before = await stored(r);

    await answers(
      await r.send("POST", `/${r.lunch}/delete`, r.supervisor, {
        replacementPeriodId: r.afternoon,
        expectedClockRevision: 0,
      }),
      403,
      { code: "authorization.not_permitted", params: { permission: "venue_service.manage" } },
    );
    expect(await stored(r)).toEqual(before);
  });

  it("answers each refusal of the delete with its code and status, changing nothing", async () => {
    const r = await routed();
    const before = await stored(r);
    const missing = randomUUID();
    const remove = (periodId: string, body: unknown) =>
      r.send("POST", `/${periodId}/delete`, r.manager, body);

    await answers(
      await remove(missing, { replacementPeriodId: null, expectedClockRevision: 0 }),
      404,
      {
        code: "menu_period.not_found",
        params: { periodId: missing },
      },
    );
    for (const replacementPeriodId of [r.deliLunch, r.lunch, missing])
      await answers(await remove(r.lunch, { replacementPeriodId, expectedClockRevision: 0 }), 400, {
        code: "menu_period.invalid",
        params: { field: "replacementPeriodId" },
      });
    await answers(
      await remove(r.lunch, { replacementPeriodId: r.afternoon, expectedClockRevision: 1 }),
      409,
      { code: "hours.clock_changed", params: {} },
    );
    expect(await stored(r)).toEqual(before);
  });

  it("refuses a body missing the replacement, holding another key or a malformed replacement, naming the field and changing nothing", async () => {
    const r = await routed();
    const before = await stored(r);
    const cases: [unknown, string][] = [
      [{ expectedClockRevision: 0 }, "replacementPeriodId"],
      [{ replacementPeriodId: "not-a-uuid", expectedClockRevision: 0 }, "replacementPeriodId"],
      [{ replacementPeriodId: null, expectedClockRevision: 0, force: true }, "force"],
      [{}, "replacementPeriodId"],
    ];
    for (const [body, field] of cases)
      await answers(await r.send("POST", `/${r.lunch}/delete`, r.manager, body), 400, {
        code: "management.request_invalid",
        params: { field },
      });
    expect(await stored(r)).toEqual(before);
  });

  it("refuses a body with no clock revision as a stale one, as the other hours writes do, changing nothing", async () => {
    const r = await routed();
    const before = await stored(r);
    for (const replacementPeriodId of [null, r.afternoon])
      await answers(
        await r.send("POST", `/${r.lunch}/delete`, r.manager, { replacementPeriodId }),
        409,
        {
          code: "hours.clock_changed",
          params: {},
        },
      );
    expect(await stored(r)).toEqual(before);
  });

  it("the retired DELETE finds no route and changes nothing", async () => {
    const r = await routed();
    const before = await stored(r);
    const response = await r.app.request(`${BASE}/${r.lunch}`, {
      method: "DELETE",
      headers: { cookie: r.manager },
    });
    expect(response.status).toBe(404);
    expect(await stored(r)).toEqual(before);
  });
});
