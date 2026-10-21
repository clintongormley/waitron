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
      await saveMenuPeriod(tx, cfg, restaurant, { name: "Dinner", menuId, staffMenuIds: [] })
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

describe("the season days read route", () => {
  it("answers each asked date's season hours to a viewer, in order and once each", async () => {
    const r = await routed();
    await answers(
      await r.send(
        "GET",
        "/opening-hours/season-days?dates=2030-12-24,2030-11-30,2030-12-24",
        r.supervisor,
      ),
      200,
      {
        days: [
          { date: "2030-12-24", seasonId: r.seasons.Winter },
          { date: "2030-11-30", seasonId: r.seasons.Autumn },
        ].map((day) => ({
          ...day,
          dayCutover: "06:00",
          departments: [
            {
              departmentId: r.restaurant,
              ranges: [{ periodId: expect.any(String), startsAt: "19:00", endsAt: "23:00" }],
              zones: [],
            },
          ],
        })),
      },
    );
  });

  it("serves 62 dates at both ends of the calendar", async () => {
    const r = await routed();
    const dates = [
      ...Array.from({ length: 31 }, (_, i) => `0100-01-${String(i + 1).padStart(2, "0")}`),
      ...Array.from({ length: 31 }, (_, i) => `9998-12-${String(i + 1).padStart(2, "0")}`),
    ];
    const response = await r.send(
      "GET",
      `/opening-hours/season-days?dates=${dates.join(",")}`,
      r.manager,
    );
    expect(response.status).toBe(200);
    const read = (await response.json()) as { days: { date: string }[] };
    expect(read.days.map(({ date }) => date)).toEqual(dates);
  });

  it("refuses a missing, empty or malformed list, a date outside 0100 to 9998, 63 dates, and an anonymous read", async () => {
    const r = await routed();
    const sixtyThree = Array.from({ length: 63 }, (_, i) =>
      new Date(Date.UTC(2030, 0, i + 1)).toISOString().slice(0, 10),
    ).join(",");
    for (const query of [
      "",
      "?dates=",
      "?dates=2030-12-24,",
      "?dates=2030-12-24,,2030-12-25",
      "?dates=2030-02-30",
      "?dates=2030-12-24,tomorrow",
      "?dates=2030-12-24%20",
      "?dates=0099-12-31",
      "?dates=9999-01-01",
      `?dates=${sixtyThree}`,
    ])
      await answers(await r.send("GET", `/opening-hours/season-days${query}`, r.manager), 400, {
        error: { code: "management.request_invalid", params: { field: "dates" } },
      });
    expect((await r.send("GET", "/opening-hours/season-days?dates=2030-12-24", "")).status).toBe(
      401,
    );
  });
});

describe("the season routes", () => {
  const put = (r: Routed, cookie: string, body: unknown) => r.send("PUT", "/seasons", cookie, body);
  const change = (sent: Record<string, unknown>) => ({
    save: [],
    delete: [],
    expectedClockRevision: 0,
    ...sent,
  });
  const invalid = (field: string) => ({
    error: { code: "management.request_invalid", params: { field } },
  });

  it("PUT /seasons renames and moves a season, answering the seasons", async () => {
    const r = await routed();
    const response = await put(
      r,
      r.manager,
      change({
        save: [{ id: r.seasons.Summer, name: " Verano ", startsOn: "06-15", colour: "amber" }],
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toContainEqual({
      id: r.seasons.Summer,
      name: "Verano",
      startsOn: "06-15",
      colour: "amber",
    });
    expect(await stored(r)).toContainEqual({
      id: r.seasons.Summer,
      name: "Verano",
      startsOn: "06-15",
      colour: "amber",
    });
  });

  it("PUT /seasons adds a season", async () => {
    const r = await routed();
    const response = await put(
      r,
      r.manager,
      change({ save: [{ name: "Feria", startsOn: "04-20", colour: "teal" }] }),
    );
    expect(response.status).toBe(200);
    const answered = (await response.json()) as { id: string; name: string }[];
    const feria = answered.find((season) => season.name === "Feria")!;
    expect(feria).toEqual({ id: feria.id, name: "Feria", startsOn: "04-20", colour: "teal" });
    expect(await stored(r)).toEqual(answered);
    expect((await stored(r)).map(({ name }) => name)).toEqual([
      "Spring",
      "Feria",
      "Summer",
      "Autumn",
      "Winter",
    ]);
  });

  it("PUT /seasons deletes a season", async () => {
    const r = await routed();
    const response = await put(r, r.manager, change({ delete: [r.seasons.Autumn] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(await stored(r));
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

  it("refuses a viewer, writing nothing", async () => {
    const r = await routed();
    const before = await stored(r);
    const response = await put(
      r,
      r.supervisor,
      change({
        save: [{ id: r.seasons.Summer, name: "X", startsOn: "07-01", colour: "red" }],
        delete: [r.seasons.Autumn],
      }),
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "authorization.not_permitted",
    );
    expect(await stored(r)).toEqual(before);
  });

  it("answers season.invalid with 400, naming the path", async () => {
    const r = await routed();
    await answers(
      await put(
        r,
        r.manager,
        change({
          save: [{ id: r.seasons.Summer, name: "Winter", startsOn: "06-01", colour: "amber" }],
        }),
      ),
      400,
      { error: { code: "season.invalid", params: { field: "save.0.name", reason: "taken" } } },
    );
    await answers(
      await put(
        r,
        r.manager,
        change({ save: [{ name: "Leap", startsOn: "02-29", colour: "red" }] }),
      ),
      400,
      { error: { code: "season.invalid", params: { field: "save.0.startsOn" } } },
    );
    await answers(
      await put(r, r.manager, change({ save: [{ name: 7, startsOn: "04-10", colour: "red" }] })),
      400,
      { error: { code: "season.invalid", params: { field: "save.0.name" } } },
    );
  });

  it("answers season.not_found with 404 for an id it does not hold", async () => {
    const r = await routed();
    const missing = randomUUID();
    const error = { error: { code: "season.not_found", params: { seasonId: missing } } };
    await answers(
      await put(
        r,
        r.manager,
        change({ save: [{ id: missing, name: "X", startsOn: "07-01", colour: "red" }] }),
      ),
      404,
      error,
    );
    await answers(await put(r, r.manager, change({ delete: [missing] })), 404, error);
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
    await answers(await put(r, r.manager, change({ name: "X" })), 400, invalid("name"));
    await answers(
      await put(
        r,
        r.manager,
        change({ save: [{ name: "X", startsOn: "07-01", colour: "red", lastDay: "08-01" }] }),
      ),
      400,
      invalid("save.0.lastDay"),
    );
  });

  it("refuses a malformed body", async () => {
    const r = await routed();
    const before = await stored(r);
    const summer = { id: r.seasons.Summer, name: "Summer", startsOn: "06-01", colour: "amber" };
    for (const [body, field] of [
      [change({ save: { name: "X" } }), "save"],
      [change({ save: null }), "save"],
      [change({ delete: null }), "delete"],
      [change({ save: ["X"] }), "save.0"],
      [change({ save: [null] }), "save.0"],
      [change({ save: [[]] }), "save.0"],
      [change({ save: [{ ...summer, id: "not-a-uuid" }] }), "save.0.id"],
      [change({ save: [{ ...summer, id: 7 }] }), "save.0.id"],
      [change({ delete: r.seasons.Autumn }), "delete"],
      [change({ delete: ["not-a-uuid"] }), "delete.0"],
      [change({ delete: [7] }), "delete.0"],
      [change({ delete: [null] }), "delete.0"],
      [change({ save: [summer, { ...summer, name: "Verano" }] }), "save.1.id"],
      [change({ delete: [r.seasons.Autumn, r.seasons.Autumn] }), "delete.1"],
      [change({ save: [summer], delete: [r.seasons.Autumn, r.seasons.Summer] }), "delete.1"],
    ] as const)
      await answers(await put(r, r.manager, body), 400, invalid(field));
    expect(await stored(r)).toEqual(before);
  });

  it("refuses a call with no clock revision, a rename included, writing nothing", async () => {
    const r = await routed();
    const before = await stored(r);
    const error = { error: { code: "hours.clock_changed", params: {} } };
    await answers(
      await put(r, r.manager, {
        save: [{ id: r.seasons.Summer, name: "Verano", startsOn: "06-01", colour: "amber" }],
        delete: [],
      }),
      409,
      error,
    );
    await answers(
      await put(r, r.manager, {
        save: [{ name: "Feria", startsOn: "04-20", colour: "teal" }],
        delete: [],
      }),
      409,
      error,
    );
    await answers(await put(r, r.manager, { save: [], delete: [r.seasons.Summer] }), 409, error);
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
      await put(
        r,
        r.manager,
        change({
          save: [{ id: r.seasons.Summer, name: "Summer", startsOn: "06-15", colour: "amber" }],
        }),
      ),
      409,
      error,
    );
    await answers(
      await put(
        r,
        r.manager,
        change({ save: [{ name: "Feria", startsOn: "04-20", colour: "teal" }] }),
      ),
      409,
      error,
    );
    await answers(await put(r, r.manager, change({ delete: [r.seasons.Summer] })), 409, error);
    expect(await stored(r)).toEqual(before);
  });
});
