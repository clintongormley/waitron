import { randomUUID } from "node:crypto";
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
import { locationId as brandLocationId } from "@waitron/shared";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import { replaceMenuWeek, saveMenuPeriod } from "./menu-timetable.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { createDepartment } from "./operations.js";
import { VENUE_SERVICE_PERMISSIONS } from "./permissions.js";
import { VENUE_SERVICE_ROUTES } from "./routes.js";
import { readSeasons } from "./seasons.js";

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
const BASE = "/management-api/venue-service";
const noopLog: Logger = () => {};

/** A venue whose restaurant serves dinner every day in every season. */
async function routed() {
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
  const cfg = { locationId: brandLocationId(location!.id) };
  const made = await scoped(async (tx) => {
    const restaurant = (
      await createDepartment(tx, cfg, { name: "Restaurant", orderStart: "table" })
    ).id;
    const menuId = (await createCatalogue(tx, { name: `Dinner ${randomUUID()}` })).id;
    const { document } = await buildMenuDocument(tx, menuId);
    await publishMenu(tx, menuId, menuDocumentHash(document), "person-1");
    const dinner = (
      await saveMenuPeriod(tx, cfg, restaurant, { name: "Dinner", menuId, staffMenuIds: [] }, 0)
    ).id;
    await replaceMenuWeek(
      tx,
      cfg,
      restaurant,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [{ periodId: dinner, startsAt: "19:00", endsAt: "23:00" }],
      })),
      new Date(),
      0,
    );
    const person = async (role: "manager" | "supervisor") => {
      const [row] = await tx
        .insert(persons)
        .values({ displayName: `${role} ${randomUUID()}`, pinHash: hashPin("1234"), role })
        .returning({ id: persons.id });
      return `${MANAGEMENT_COOKIE}=${(await startManagementSession(tx, { personId: row!.id })).token}`;
    };
    const seasons = Object.fromEntries(
      (await readSeasons(tx, cfg)).map((season) => [season.name, season.id]),
    );
    return {
      restaurant,
      seasons,
      manager: await person("manager"),
      supervisor: await person("supervisor"),
    };
  });
  const app = new Hono();
  VENUE_SERVICE_ROUTES.mount(app, { db, cfg, core: {} as ModuleRouteContext["core"] }, noopLog);
  const send = (
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    cookie: string,
    body?: unknown,
  ) =>
    app.request(`${BASE}${path}`, {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { ...made, cfg, send };
}
type Routed = Awaited<ReturnType<typeof routed>>;

const stored = (r: Routed) => scoped((tx) => readSeasons(tx, r.cfg));

async function answers(response: Response, status: number, body?: unknown) {
  expect(response.status).toBe(status);
  if (body !== undefined) expect(await response.json()).toEqual(body);
}

describe("the year read route", () => {
  it("answers a year's days and seasons to a viewer", async () => {
    const r = await routed();
    const response = await r.send("GET", "/opening-hours/year?year=2030", r.supervisor);
    expect(response.status).toBe(200);
    const year = (await response.json()) as {
      year: number;
      days: { date: string; seasonId: string | null; closed: boolean }[];
      seasons: { name: string; lastDay: string }[];
      clockRevision: number;
      missingHolidays: unknown[];
    };
    expect(year.year).toBe(2030);
    expect(year.days).toHaveLength(365);
    expect(year.days.find(({ date }) => date === "2030-08-15")).toMatchObject({
      date: "2030-08-15",
      seasonId: r.seasons.Summer,
      closed: false,
    });
    expect(year.seasons.map(({ name, lastDay }) => ({ name, lastDay }))).toEqual([
      { name: "Spring", lastDay: "05-31" },
      { name: "Summer", lastDay: "08-31" },
      { name: "Autumn", lastDay: "11-30" },
      { name: "Winter", lastDay: "02-28" },
    ]);
    expect(year.clockRevision).toBe(0);
    expect(year.missingHolidays).toEqual([]);
  });

  it("refuses a year that is not four digits, and an anonymous read", async () => {
    const r = await routed();
    for (const query of ["", "?year=", "?year=20x0", "?year=30000", "?year=2030.5"])
      await answers(await r.send("GET", `/opening-hours/year${query}`, r.manager), 400, {
        error: { code: "management.request_invalid", params: { field: "year" } },
      });
    expect((await r.send("GET", "/opening-hours/year?year=2030", "")).status).toBe(401);
  });

  it("refuses a year outside 0100 to 9998 the same way, and serves both ends", async () => {
    const r = await routed();
    for (const year of ["0000", "0001", "0099", "9999"])
      await answers(await r.send("GET", `/opening-hours/year?year=${year}`, r.manager), 400, {
        error: { code: "management.request_invalid", params: { field: "year" } },
      });
    for (const [year, first] of [
      ["0100", "0100-01-01"],
      ["9998", "9998-01-01"],
    ] as const) {
      const response = await r.send("GET", `/opening-hours/year?year=${year}`, r.manager);
      expect(response.status).toBe(200);
      const read = (await response.json()) as { year: number; days: { date: string }[] };
      expect({ year: read.year, first: read.days[0]!.date, last: read.days.at(-1)!.date }).toEqual({
        year: Number(year),
        first,
        last: `${year}-12-31`,
      });
    }
  });
});

describe("the month read route", () => {
  it("answers a month's whole weeks to a viewer", async () => {
    const r = await routed();
    const response = await r.send("GET", "/opening-hours/month?month=2030-12", r.supervisor);
    expect(response.status).toBe(200);
    const month = (await response.json()) as {
      month: string;
      days: { date: string; inMonth: boolean; seasonId: string | null }[];
      seasons: { name: string; lastDay: string }[];
    };
    expect(month.month).toBe("2030-12");
    expect(month.days).toHaveLength(42);
    expect(month.days[0]).toMatchObject({
      date: "2030-11-25",
      inMonth: false,
      seasonId: r.seasons.Autumn,
    });
    expect(month.days.at(-1)).toMatchObject({
      date: "2031-01-05",
      inMonth: false,
      seasonId: r.seasons.Winter,
    });
    expect(month.seasons.map(({ name, lastDay }) => ({ name, lastDay }))).toEqual([
      { name: "Autumn", lastDay: "11-30" },
      { name: "Winter", lastDay: "02-28" },
    ]);
  });

  it("refuses a month that is not YYYY-MM from 0100-02 to 9998-12, and an anonymous read", async () => {
    const r = await routed();
    for (const query of [
      "",
      "?month=",
      "?month=2030",
      "?month=2030-00",
      "?month=2030-13",
      "?month=2030-1",
      "?month=2030-12-01",
      "?month=0099-12",
      "?month=0100-01",
      "?month=9999-01",
    ])
      await answers(await r.send("GET", `/opening-hours/month${query}`, r.manager), 400, {
        error: { code: "management.request_invalid", params: { field: "month" } },
      });
    expect((await r.send("GET", "/opening-hours/month?month=2030-12", "")).status).toBe(401);
  });

  it("serves both ends of the calendar, reaching into the years beyond them", async () => {
    const r = await routed();
    for (const [month, first, last] of [
      ["0100-02", "0100-02-01", "0100-02-28"],
      ["9998-12", "9998-11-30", "9999-01-03"],
    ] as const) {
      const response = await r.send("GET", `/opening-hours/month?month=${month}`, r.manager);
      expect(response.status).toBe(200);
      const read = (await response.json()) as { days: { date: string }[] };
      expect({ first: read.days[0]!.date, last: read.days.at(-1)!.date }).toEqual({ first, last });
    }
  });
});

describe("the season routes", () => {
  it("PUT renames and moves a season, answering it", async () => {
    const r = await routed();
    await answers(
      await r.send("PUT", `/seasons/${r.seasons.Summer}`, r.manager, {
        name: " Verano ",
        startsOn: "06-15",
        expectedClockRevision: 0,
      }),
      200,
      { id: r.seasons.Summer, name: "Verano", startsOn: "06-15" },
    );
    expect(await stored(r)).toContainEqual({
      id: r.seasons.Summer,
      name: "Verano",
      startsOn: "06-15",
    });
  });

  it("POST adds a season and answers 201 with it", async () => {
    const r = await routed();
    const response = await r.send("POST", "/seasons", r.manager, {
      name: "Feria",
      startsOn: "04-20",
      expectedClockRevision: 0,
    });
    expect(response.status).toBe(201);
    const added = (await response.json()) as { id: string };
    expect(added).toEqual({ id: added.id, name: "Feria", startsOn: "04-20" });
    expect((await stored(r)).map(({ name }) => name)).toEqual([
      "Spring",
      "Feria",
      "Summer",
      "Autumn",
      "Winter",
    ]);
  });

  it("DELETE removes a season and answers 204", async () => {
    const r = await routed();
    await answers(
      await r.send("DELETE", `/seasons/${r.seasons.Autumn}`, r.manager, {
        expectedClockRevision: 0,
      }),
      204,
    );
    expect((await stored(r)).map(({ name }) => name)).toEqual(["Spring", "Summer", "Winter"]);
  });

  it("GET delete-impact names the departments that painted the season, to a viewer", async () => {
    const r = await routed();
    await answers(
      await r.send("GET", `/seasons/${r.seasons.Winter}/delete-impact`, r.supervisor),
      200,
      { departments: [{ id: r.restaurant, name: "Restaurant" }] },
    );
  });

  it("refuses a viewer every write, writing nothing", async () => {
    const r = await routed();
    const before = await stored(r);
    const body = { name: "X", startsOn: "07-01", expectedClockRevision: 0 };
    for (const response of [
      await r.send("POST", "/seasons", r.supervisor, body),
      await r.send("PUT", `/seasons/${r.seasons.Summer}`, r.supervisor, body),
      await r.send("DELETE", `/seasons/${r.seasons.Summer}`, r.supervisor, {
        expectedClockRevision: 0,
      }),
    ]) {
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        "authorization.not_permitted",
      );
    }
    expect(await stored(r)).toEqual(before);
  });

  it("answers season.invalid with 400, naming the field", async () => {
    const r = await routed();
    await answers(
      await r.send("PUT", `/seasons/${r.seasons.Summer}`, r.manager, {
        name: "Winter",
        startsOn: "06-01",
        expectedClockRevision: 0,
      }),
      400,
      { error: { code: "season.invalid", params: { field: "name", reason: "taken" } } },
    );
    await answers(
      await r.send("POST", "/seasons", r.manager, {
        name: "Leap",
        startsOn: "02-29",
        expectedClockRevision: 0,
      }),
      400,
      { error: { code: "season.invalid", params: { field: "startsOn" } } },
    );
    await answers(
      await r.send("POST", "/seasons", r.manager, {
        name: 7,
        startsOn: "04-10",
        expectedClockRevision: 0,
      }),
      400,
      { error: { code: "season.invalid", params: { field: "name" } } },
    );
  });

  it("answers season.not_found with 404 for a season it does not hold", async () => {
    const r = await routed();
    const missing = randomUUID();
    const error = { error: { code: "season.not_found", params: { seasonId: missing } } };
    await answers(
      await r.send("PUT", `/seasons/${missing}`, r.manager, {
        name: "X",
        startsOn: "07-01",
        expectedClockRevision: 0,
      }),
      404,
      error,
    );
    await answers(
      await r.send("DELETE", `/seasons/${missing}`, r.manager, { expectedClockRevision: 0 }),
      404,
      error,
    );
    await answers(await r.send("GET", `/seasons/${missing}/delete-impact`, r.manager), 404, error);
  });

  it("refuses a malformed season id", async () => {
    const r = await routed();
    await answers(await r.send("GET", "/seasons/not-a-uuid/delete-impact", r.manager), 400, {
      error: { code: "shared.invalid_id", params: { kind: "SeasonId", value: "not-a-uuid" } },
    });
  });

  it("refuses a key it does not take", async () => {
    const r = await routed();
    const body = { name: "X", startsOn: "07-01", expectedClockRevision: 0, colour: "red" };
    const error = { error: { code: "management.request_invalid", params: { field: "colour" } } };
    await answers(await r.send("POST", "/seasons", r.manager, body), 400, error);
    await answers(await r.send("PUT", `/seasons/${r.seasons.Summer}`, r.manager, body), 400, error);
  });

  it("refuses every write with no clock revision, a rename included, writing nothing", async () => {
    const r = await routed();
    const before = await stored(r);
    const error = { error: { code: "hours.clock_changed", params: {} } };
    await answers(
      await r.send("PUT", `/seasons/${r.seasons.Summer}`, r.manager, {
        name: "Verano",
        startsOn: "06-01",
      }),
      409,
      error,
    );
    await answers(
      await r.send("POST", "/seasons", r.manager, { name: "Feria", startsOn: "04-20" }),
      409,
      error,
    );
    await answers(
      await r.send("DELETE", `/seasons/${r.seasons.Summer}`, r.manager, {}),
      409,
      error,
    );
    expect(await stored(r)).toEqual(before);
  });

  it("refuses a stale clock revision on a move, an add and a delete, writing nothing", async () => {
    const r = await routed();
    await scoped((tx) =>
      tx.insert(locationBusinessDaySettings).values({ locationId: r.cfg.locationId, revision: 1 }),
    );
    const before = await stored(r);
    const error = { error: { code: "hours.clock_changed", params: {} } };
    await answers(
      await r.send("PUT", `/seasons/${r.seasons.Summer}`, r.manager, {
        name: "Summer",
        startsOn: "06-15",
        expectedClockRevision: 0,
      }),
      409,
      error,
    );
    await answers(
      await r.send("POST", "/seasons", r.manager, {
        name: "Feria",
        startsOn: "04-20",
        expectedClockRevision: 0,
      }),
      409,
      error,
    );
    await answers(
      await r.send("DELETE", `/seasons/${r.seasons.Summer}`, r.manager, {
        expectedClockRevision: 0,
      }),
      409,
      error,
    );
    expect(await stored(r)).toEqual(before);
  });
});
