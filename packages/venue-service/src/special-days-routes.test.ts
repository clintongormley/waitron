import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
  floorZones,
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
import { saveMenuPeriod } from "./menu-timetable.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { configureZone, createDepartment } from "./operations.js";
import { VENUE_SERVICE_PERMISSIONS } from "./permissions.js";
import { VENUE_SERVICE_ROUTES } from "./routes.js";
import { specialDays } from "./schema/seasons.js";
import { readSpecialDay, saveSpecialDay, type SpecialDayDetail } from "./special-days.js";

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
const BASE = "/management-api/venue-service/special-days";
const noopLog: Logger = () => {};

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
  const [zone] = await db
    .insert(floorZones)
    .values({ locationId: cfg.locationId, name: "Sala", displayOrder: 0 })
    .returning({ id: floorZones.id });
  const made = await scoped(async (tx) => {
    const restaurant = (
      await createDepartment(tx, cfg, { name: "Restaurant", orderStart: "table" })
    ).id;
    await configureZone(tx, cfg, { zoneId: zone!.id, departmentId: restaurant });
    const menuId = (await createCatalogue(tx, { name: "Dinner" })).id;
    const { document } = await buildMenuDocument(tx, menuId);
    await publishMenu(tx, menuId, menuDocumentHash(document), "person-1");
    const dinner = (
      await saveMenuPeriod(tx, cfg, restaurant, { name: "Dinner", menuId, staffMenuIds: [] }, 0)
    ).id;
    const person = async (role: "manager" | "supervisor") => {
      const [row] = await tx
        .insert(persons)
        .values({ displayName: `${role} ${randomUUID()}`, pinHash: hashPin("1234"), role })
        .returning({ id: persons.id });
      return `${MANAGEMENT_COOKIE}=${(await startManagementSession(tx, { personId: row!.id })).token}`;
    };
    return {
      restaurant,
      dinner,
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
  return { ...made, cfg, sala: zone!.id, app, send };
}
type Routed = Awaited<ReturnType<typeof routed>>;

const christmas = (r: Routed) => ({
  name: "Navidad",
  repeatsYearly: false,
  dates: [
    { date: "2030-12-24", closedAllDay: false },
    { date: "2030-12-25", closedAllDay: true },
  ],
  paint: [
    {
      departmentId: r.restaurant,
      date: "2030-12-24",
      ranges: [{ periodId: r.dinner, startsAt: "19:00", endsAt: "23:00" }],
    },
  ],
  zonePaint: [
    {
      zoneId: r.sala,
      date: "2030-12-24",
      ranges: [{ kind: "closed", startsAt: "19:00", endsAt: "20:00" }],
    },
  ],
});

const expectedDetail = (r: Routed, id: string) => ({
  id,
  name: "Navidad",
  repeatsYearly: false,
  dates: [
    { date: "2030-12-24", closedAllDay: false },
    { date: "2030-12-25", closedAllDay: true },
  ],
  paint: [
    {
      departmentId: r.restaurant,
      date: "2030-12-24",
      ranges: [{ periodId: r.dinner, startsAt: "19:00", endsAt: "23:00" }],
    },
  ],
  zonePaint: [
    {
      zoneId: r.sala,
      date: "2030-12-24",
      ranges: [{ kind: "closed", startsAt: "19:00", endsAt: "20:00" }],
    },
  ],
});

const seeded = (r: Routed) =>
  scoped((tx) => saveSpecialDay(tx, r.cfg, null, christmas(r), new Date(), 0));
const stored = (r: Routed, id: string) => scoped((tx) => readSpecialDay(tx, r.cfg, id));
const countDays = async (r: Routed) =>
  (await db.select().from(specialDays).where(eq(specialDays.locationId, r.cfg.locationId))).length;

async function answers(response: Response, status: number, error?: Record<string, unknown>) {
  expect(response.status).toBe(status);
  if (error !== undefined) expect(await response.json()).toEqual({ error });
}

async function refusedAs(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(code);
}

describe("the special-day routes", () => {
  it("POST creates a special day and answers 201 with it", async () => {
    const r = await routed();
    const response = await r.send("POST", "", r.manager, {
      ...christmas(r),
      expectedClockRevision: 0,
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as SpecialDayDetail;
    expect(body).toEqual(expectedDetail(r, body.id));
    expect(await stored(r, body.id)).toEqual(body);
  });

  it("GET reads a special day for a venue viewer", async () => {
    const r = await routed();
    const day = await seeded(r);
    const response = await r.send("GET", `/${day.id}`, r.supervisor);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expectedDetail(r, day.id));
  });

  it("GET lists the venue's special days with their dates for a venue viewer, by name", async () => {
    const r = await routed();
    const navidad = await seeded(r);
    const fair = await scoped((tx) =>
      saveSpecialDay(
        tx,
        r.cfg,
        null,
        {
          name: "Feria",
          repeatsYearly: true,
          dates: [{ date: "2030-04-20", closedAllDay: true }],
        },
        new Date(),
        0,
      ),
    );
    const response = await r.send("GET", "", r.supervisor);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: fair.id,
        name: "Feria",
        repeatsYearly: true,
        dates: [{ date: "2030-04-20", closedAllDay: true }],
      },
      {
        id: navidad.id,
        name: "Navidad",
        repeatsYearly: false,
        dates: [
          { date: "2030-12-24", closedAllDay: false },
          { date: "2030-12-25", closedAllDay: true },
        ],
      },
    ]);
  });

  it("GET lists nothing for a venue with no special days, and refuses a request with no session", async () => {
    const r = await routed();
    const response = await r.send("GET", "", r.manager);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect((await r.send("GET", "", "")).status).toBe(401);
  });

  it("PUT updates a special day and keeps paint the body leaves out", async () => {
    const r = await routed();
    const day = await seeded(r);
    const response = await r.send("PUT", `/${day.id}`, r.manager, {
      name: "Nochebuena",
      repeatsYearly: false,
      dates: [{ date: "2030-12-24", closedAllDay: false }],
      expectedClockRevision: 0,
    });
    expect(response.status).toBe(200);
    const expected = {
      ...expectedDetail(r, day.id),
      name: "Nochebuena",
      dates: [{ date: "2030-12-24", closedAllDay: false }],
    };
    expect(await response.json()).toEqual(expected);
    expect(await stored(r, day.id)).toEqual(expected);
  });

  it("DELETE removes a special day and answers 204", async () => {
    const r = await routed();
    const day = await seeded(r);
    await answers(
      await r.send("DELETE", `/${day.id}`, r.manager, { expectedClockRevision: 0 }),
      204,
    );
    expect(await countDays(r)).toBe(0);
  });

  it("refuses an unknown body key on POST and PUT, writing nothing", async () => {
    const r = await routed();
    const day = await seeded(r);
    const body = { ...christmas(r), expectedClockRevision: 0, id: randomUUID() };
    await answers(await r.send("POST", "", r.manager, body), 400, {
      code: "management.request_invalid",
      params: { field: "id" },
    });
    await answers(await r.send("PUT", `/${day.id}`, r.manager, { ...body, name: "X" }), 400, {
      code: "management.request_invalid",
      params: { field: "id" },
    });
    expect(await countDays(r)).toBe(1);
    expect(await stored(r, day.id)).toEqual(day);
  });

  it("refuses a viewer every write, writing nothing", async () => {
    const r = await routed();
    const day = await seeded(r);
    const body = { ...christmas(r), expectedClockRevision: 0 };
    for (const response of [
      await r.send("POST", "", r.supervisor, body),
      await r.send("PUT", `/${day.id}`, r.supervisor, body),
      await r.send("DELETE", `/${day.id}`, r.supervisor, { expectedClockRevision: 0 }),
    ])
      await refusedAs(response, 403, "authorization.not_permitted");
    expect(await countDays(r)).toBe(1);
    expect(await stored(r, day.id)).toEqual(day);
  });

  it("answers special_day.not_found for an id it does not hold", async () => {
    const r = await routed();
    const missing = randomUUID();
    const error = { code: "special_day.not_found", params: { specialDayId: missing } };
    await answers(await r.send("GET", `/${missing}`, r.manager), 404, error);
    await answers(
      await r.send("PUT", `/${missing}`, r.manager, { ...christmas(r), expectedClockRevision: 0 }),
      404,
      error,
    );
    await answers(
      await r.send("DELETE", `/${missing}`, r.manager, { expectedClockRevision: 0 }),
      404,
      error,
    );
  });

  it("refuses a malformed id", async () => {
    const r = await routed();
    await answers(await r.send("GET", "/not-a-uuid", r.manager), 400, {
      code: "shared.invalid_id",
      params: { kind: "SpecialDayId", value: "not-a-uuid" },
    });
  });

  it("refuses a write with no clock revision or a stale one, writing nothing", async () => {
    const r = await routed();
    const day = await seeded(r);
    await scoped((tx) =>
      tx.insert(locationBusinessDaySettings).values({ locationId: r.cfg.locationId, revision: 1 }),
    );
    const error = { code: "hours.clock_changed", params: {} };
    for (const expectedClockRevision of [undefined, 0]) {
      const revision = expectedClockRevision === undefined ? {} : { expectedClockRevision };
      await answers(
        await r.send("POST", "", r.manager, { ...christmas(r), name: "Nueva", ...revision }),
        409,
        error,
      );
      await answers(
        await r.send("PUT", `/${day.id}`, r.manager, { ...christmas(r), name: "X", ...revision }),
        409,
        error,
      );
      await answers(await r.send("DELETE", `/${day.id}`, r.manager, revision), 409, error);
    }
    expect(await countDays(r)).toBe(1);
    expect(await stored(r, day.id)).toEqual(day);
    await answers(
      await r.send("DELETE", `/${day.id}`, r.manager, { expectedClockRevision: 1 }),
      204,
    );
  });

  it("refuses a write with no clock revision while the stored one is still 0, writing nothing", async () => {
    const r = await routed();
    const day = await seeded(r);
    const error = { code: "hours.clock_changed", params: {} };
    await answers(
      await r.send("POST", "", r.manager, { ...christmas(r), name: "Nueva" }),
      409,
      error,
    );
    await answers(
      await r.send("PUT", `/${day.id}`, r.manager, { ...christmas(r), name: "X" }),
      409,
      error,
    );
    await answers(await r.send("DELETE", `/${day.id}`, r.manager, {}), 409, error);
    expect(await countDays(r)).toBe(1);
    expect(await stored(r, day.id)).toEqual(day);
  });

  it("answers special_day.date_taken with 409, naming the holder", async () => {
    const r = await routed();
    const day = await seeded(r);
    await answers(
      await r.send("POST", "", r.manager, {
        name: "Otra",
        repeatsYearly: false,
        dates: [{ date: "2030-12-25", closedAllDay: false }],
        expectedClockRevision: 0,
      }),
      409,
      {
        code: "special_day.date_taken",
        params: { date: "2030-12-25", specialDayId: day.id, name: "Navidad" },
      },
    );
    expect(await countDays(r)).toBe(1);
  });

  it("answers special_day.invalid with 400", async () => {
    const r = await routed();
    const response = await r.send("POST", "", r.manager, {
      name: "Rota",
      repeatsYearly: false,
      dates: [{ date: "2030-13-40", closedAllDay: false }],
      expectedClockRevision: 0,
    });
    await answers(response, 400, {
      code: "special_day.invalid",
      params: { field: "dates.0.date" },
    });
  });
});
