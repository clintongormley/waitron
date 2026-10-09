import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  locations,
  tenants,
  withTransaction,
  type Database,
  type Transaction,
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
import { locationId } from "@waitron/shared";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import type { HolidayGeography, HolidayRead, NamedDaysModel } from "./holiday-types.js";
import { readHolidays } from "./holidays.js";
import { saveSpecialDate } from "./hours.js";
import type { HoursModel } from "./hours-types.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import type { VenueScope } from "./operations.js";
import { VENUE_SERVICE_PERMISSIONS } from "./permissions.js";
import { VENUE_SERVICE_ROUTES } from "./routes.js";
import { holidayGeographies, localHolidays } from "./schema/holidays.js";

// A spy over the real reader, so the Hours page can be shown to read holidays exactly once.
vi.mock("./holidays.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./holidays.js")>();
  return { ...actual, readHolidays: vi.fn(actual.readHolidays) };
});
const readSpy = vi.mocked(readHolidays);

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

// The tenant row is the database's one country; each test sets Spain and puts the row back after.
beforeEach(async () => {
  const before = await db.select().from(tenants);
  onTestFinished(() =>
    withTransaction(db, async (tx) => {
      await tx.delete(tenants);
      if (before.length > 0) await tx.insert(tenants).values(before);
    }),
  );
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Invented SL" })
    .onConflictDoUpdate({ target: tenants.id, set: { country: "ES" } });
});

const BASE = "/management-api/venue-service";
const noopLog: Logger = () => {};

interface Address {
  province?: string | null;
  city?: string | null;
}

interface Fixture {
  app: Hono;
  cfg: VenueScope;
  other: VenueScope;
  manager: string;
  supervisor: string;
  staff: string;
  expired: string;
}

async function fixture(address: Address = {}): Promise<Fixture> {
  const made = await withTransaction(db, async (tx) => {
    const venue = (name: string) => ({
      name: `${name} ${randomUUID()}`,
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
      timeZone: "Europe/Madrid",
      province: address.province === undefined ? "Sevilla" : address.province,
      city: address.city === undefined ? "Sevilla" : address.city,
    });
    const [location] = await tx.insert(locations).values(venue("Venue")).returning();
    const [otherLocation] = await tx.insert(locations).values(venue("Other")).returning();
    const other = { locationId: locationId(otherLocation!.id) };
    await tx
      .update(locations)
      .set({ province: "Sevilla", city: "Sevilla" })
      .where(eq(locations.id, other.locationId));
    const person = async (role: "manager" | "supervisor" | "staff") => {
      const [row] = await tx
        .insert(persons)
        .values({ displayName: `${role} ${randomUUID()}`, pinHash: hashPin("1234"), role })
        .returning({ id: persons.id });
      return (await startManagementSession(tx, { personId: row!.id })).token;
    };
    return {
      cfg: { locationId: locationId(location!.id) },
      other,
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

const direct = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(db, fn);

/** Every geography and entry of both fixture venues, so a refusal can be shown to change none. */
async function rows(fx: Fixture) {
  const ids = [fx.cfg.locationId, fx.other.locationId];
  const geographies = await db
    .select()
    .from(holidayGeographies)
    .where(inArray(holidayGeographies.locationId, ids))
    .orderBy(asc(holidayGeographies.id));
  const entries = await db
    .select()
    .from(localHolidays)
    .where(
      inArray(
        localHolidays.geographyId,
        geographies.map(({ id }) => id),
      ),
    )
    .orderBy(asc(localHolidays.id));
  return { geographies, entries };
}

async function create(fx: Fixture, date: string, name: string) {
  return direct((tx) =>
    saveSpecialDate(
      tx,
      fx.cfg,
      null,
      {
        date,
        name,
        kind: "holiday",
        repeats: false,
        ownHours: false,
        closeWholeVenue: false,
        cells: [],
      },
      new Date("2026-01-01T12:00:00Z"),
    ),
  );
}

describe("reading holidays", () => {
  it("returns the range's holiday read to anyone who may view the venue", async () => {
    const fx = await fixture();
    await create(fx, "2026-10-20", "Feria de otoño");
    const expected = await direct((tx) => readHolidays(tx, fx.cfg, "2026-10-01", "2026-10-31"));
    const response = await send(
      fx,
      "GET",
      "/holidays?from=2026-10-01&to=2026-10-31",
      fx.supervisor,
    );
    expect(response.status).toBe(200);
    const read = (await response.json()) as HolidayRead;
    expect(read).toEqual(expected);
    // Spain's 2026 data lists 12 October nationally; the venue's own entry follows it.
    expect(read.facts.map(({ date, name, scope }) => [date, name, scope])).toEqual([
      ["2026-10-12", "Fiesta Nacional de España", "national"],
    ]);
    expect(read.coverage).toMatchObject([
      { year: 2026, country: "ES", provinceCode: "41", nationalRegional: "complete" },
    ]);
    expect(read.coverage[0]!.local).toBe("owner_entered");
    expect(read.sources.find(({ kind }) => kind === "owner")).toEqual({
      id: `owner:named-days:${fx.cfg.locationId}`,
      kind: "owner",
      title: "Venue's own holidays",
      url: null,
      sha256: null,
    });
    expect(
      (await send(fx, "GET", "/holidays?from=2026-10-01&to=2026-10-31", fx.manager)).status,
    ).toBe(200);
  });

  it("refuses a missing, reversed or over-long range as Hours does, naming the field", async () => {
    const fx = await fixture();
    await refused(await send(fx, "GET", "/holidays?to=2026-10-31", fx.manager), 400, {
      code: "hours.invalid",
      params: { field: "from" },
    });
    await refused(
      await send(fx, "GET", "/holidays?from=2026-10-31&to=2026-10-01", fx.manager),
      400,
      { code: "hours.invalid", params: { field: "to" } },
    );
    await refused(
      await send(fx, "GET", "/holidays?from=2026-01-01&to=2027-01-02", fx.manager),
      400,
      { code: "hours.invalid", params: { field: "to" } },
    );
  });

  it("refuses both reads to staff, an absent and an expired session", async () => {
    const fx = await fixture();
    for (const path of [
      "/holidays?from=2026-10-01&to=2026-10-31",
      "/named-days?from=2026-10-01&to=2026-10-31",
    ]) {
      await refused(await send(fx, "GET", path, fx.staff), 403, {
        code: "authorization.not_permitted",
      });
      await refused(await send(fx, "GET", path, undefined), 401, {
        code: "management_session.required",
      });
      await refused(await send(fx, "GET", path, fx.expired), 401, {
        code: "management_session.expired",
      });
    }
  });
});

describe("the Hours page and holidays", () => {
  it("reads holidays once and returns their coverage and sources with the days", async () => {
    const fx = await fixture();
    await create(fx, "2026-10-13", "Feria");
    const expected = await direct((tx) => readHolidays(tx, fx.cfg, "2026-10-11", "2026-10-13"));
    readSpy.mockClear();
    const response = await send(fx, "GET", "/hours?from=2026-10-11&to=2026-10-13", fx.supervisor);
    expect(response.status).toBe(200);
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(readSpy.mock.calls[0]!.slice(1)).toEqual([fx.cfg, "2026-10-11", "2026-10-13"]);
    const model = (await response.json()) as HoursModel;
    expect(model.days.map(({ date, holidays }) => ({ date, holidays }))).toEqual([
      { date: "2026-10-11", holidays: [] },
      { date: "2026-10-12", holidays: expected.facts.filter((f) => f.date === "2026-10-12") },
      { date: "2026-10-13", holidays: expected.facts.filter((f) => f.date === "2026-10-13") },
    ]);
    expect(model.days[1]!.holidays).toHaveLength(1);
    expect(model.days[2]!.holidays).toHaveLength(0);
    expect(model.holidayCoverage).toEqual(expected.coverage);
    expect(model.holidaySources).toEqual(expected.sources);
    expect(model.holidaySources.length).toBeGreaterThan(1);
  });
});

describe("holiday area", () => {
  it("offers Lleida's sourced areas, saves a choice and clears it", async () => {
    const fx = await fixture({ province: "Lleida", city: "Vielha" });
    const local = async () =>
      (await (
        await send(fx, "GET", "/named-days?from=2026-01-01&to=2026-12-31", fx.manager)
      ).json()) as NamedDaysModel;
    const fresh = await local();
    expect(fresh.area.options.map(({ key }) => key)).toEqual(["aran", "lleida-except-aran"]);
    expect(fresh.area.required).toBe(true);

    const saved = await send(fx, "PUT", "/holiday-area", fx.manager, { areaKey: "aran" });
    expect(saved.status).toBe(200);
    const geography = (await saved.json()) as HolidayGeography;
    expect(geography).toEqual({
      id: geography.id,
      country: "ES",
      provinceCode: "25",
      city: "Vielha",
      areaKey: "aran",
      matchesVenue: true,
    });
    expect((await local()).area.required).toBe(false);

    const cleared = await send(fx, "PUT", "/holiday-area", fx.manager, { areaKey: null });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ ...geography, areaKey: null });
    expect((await local()).area.required).toBe(true);
  });

  it("answers 204 when clearing a choice the address never stored, writing nothing", async () => {
    const fx = await fixture({ province: "Lleida", city: "Vielha" });
    const before = await rows(fx);
    const response = await send(fx, "PUT", "/holiday-area", fx.manager, { areaKey: null });
    expect(response.status).toBe(204);
    expect(await rows(fx)).toEqual(before);
  });

  it("refuses a missing or unknown area, and any area where none is sourced", async () => {
    const lleida = await fixture({ province: "Lleida", city: "Vielha" });
    const before = await rows(lleida);
    for (const body of [{}, { areaKey: "tenerife" }, { areaKey: 7 }])
      await refused(await send(lleida, "PUT", "/holiday-area", lleida.manager, body), 400, {
        code: "holiday.invalid",
        params: { field: "areaKey" },
      });
    expect(await rows(lleida)).toEqual(before);
    const sevilla = await fixture();
    await refused(
      await send(sevilla, "PUT", "/holiday-area", sevilla.manager, { areaKey: "aran" }),
      400,
      { code: "holiday.invalid", params: { field: "areaKey" } },
    );
  });
});

it("retired local-holiday routes are absent for a signed-in manager", async () => {
  const fx = await fixture();
  const before = await rows(fx);
  for (const [method, path] of [
    ["GET", "/local-holidays"],
    ["POST", "/local-holidays"],
    ["PUT", `/local-holidays/${randomUUID()}`],
    ["DELETE", `/local-holidays/${randomUUID()}`],
    ["DELETE", `/holiday-geographies/${randomUUID()}`],
  ] as const) {
    expect(
      (
        await send(
          fx,
          method,
          path,
          fx.manager,
          method === "POST" || method === "PUT"
            ? { date: "2026-10-20", name: "Retired" }
            : undefined,
        )
      ).status,
    ).toBe(404);
  }
  expect(await rows(fx)).toEqual(before);
});
