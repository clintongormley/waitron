import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { beforeAll, beforeEach, describe, expect, it, onTestFinished } from "vitest";
import {
  CORE_MIGRATIONS,
  settings,
  readSettings,
  VENUE_SETTINGS,
  specialDays,
  tenants,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import {
  hashPin,
  hashSessionToken,
  managementSessions,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import type { OpeningHoursYear } from "./opening-hours-calendar.js";
import type { HolidayGeography, HolidayRead } from "./holiday-types.js";
import { readHolidays } from "./holidays.js";
import { VENUE_SERVICE_PERMISSIONS } from "./permissions.js";
import { VENUE_SERVICE_ROUTES } from "./routes.js";
import { saveSpecialDay } from "./special-days.js";

registerModulePermissions(VENUE_SERVICE_PERMISSIONS);

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
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
  manager: string;
  supervisor: string;
  staff: string;
  expired: string;
}

async function fixture(address: Address = {}): Promise<Fixture> {
  const made = await withTransaction(db, async (tx) => {
    await seedVenue(tx, {
      name: `Venue ${randomUUID()}`,
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
      timeZone: "Europe/Madrid",
      province: address.province === undefined ? "Sevilla" : address.province,
      city: address.city === undefined ? "Sevilla" : address.city,
    });
    const person = async (role: "manager" | "supervisor" | "staff") => {
      const [row] = await seedPersons(tx, {
        displayName: `${role} ${randomUUID()}`,
        pinHash: hashPin("1234"),
        role,
      });
      return (await startManagementSession(tx, { personId: row!.id })).token;
    };
    return {
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

async function refused(response: Response, status: number, error: Record<string, unknown>) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error });
}

const direct = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(db, fn);

/** Every geography and entry, so a refusal can be shown to change none. */
async function rows() {
  const holidayArea = (await readSettings(db, VENUE_SETTINGS)).doc.holidayArea;
  const entries = await db.select().from(specialDays).orderBy(asc(specialDays.id));
  return { holidayArea, entries };
}

async function create(date: string, name: string) {
  return direct((tx) =>
    saveSpecialDay(
      tx,
      null,
      { name, repeatsYearly: false, dates: [{ date, closedAllDay: false }] },
      new Date("2026-01-01T12:00:00Z"),
      1,
    ),
  );
}

describe("reading holidays", () => {
  it("returns the range's holiday read to anyone who may view the venue", async () => {
    const fx = await fixture();
    await create("2026-10-20", "Autumn fair");
    const expected = await direct((tx) => readHolidays(tx, "2026-10-01", "2026-10-31"));
    const response = await send(
      fx,
      "GET",
      "/holidays?from=2026-10-01&to=2026-10-31",
      fx.supervisor,
    );
    expect(response.status).toBe(200);
    const read = (await response.json()) as HolidayRead;
    expect(read).toEqual(expected);
    // Spain's 2026 data lists 12 October nationally; the venue's special day is not a holiday.
    expect(read.facts.map(({ date, name, scope }) => [date, name, scope])).toEqual([
      ["2026-10-12", "Fiesta Nacional de España", "national"],
    ]);
    expect(read.coverage).toMatchObject([
      { year: 2026, country: "ES", provinceCode: "41", nationalRegional: "complete" },
    ]);
    expect(read.coverage[0]!.local).toBe("none_entered");
    expect(read.coverage[0]!.sourceIds).toEqual(read.sources.map(({ id }) => id));
    expect(read.sources.map(({ kind }) => kind)).toEqual(["official"]);
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

  it("refuses the holidays read to staff, an absent and an expired session", async () => {
    const fx = await fixture();
    for (const path of ["/holidays?from=2026-10-01&to=2026-10-31"]) {
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

describe("holiday area", () => {
  it("offers Lleida's sourced areas, saves a choice and clears it", async () => {
    const fx = await fixture({ province: "Lleida", city: "Vielha" });
    const local = async () =>
      (await (
        await send(fx, "GET", "/opening-hours/year?year=2026", fx.manager)
      ).json()) as OpeningHoursYear;
    const fresh = await local();
    expect(fresh.area.options.map(({ key }) => key)).toEqual(["aran", "lleida-except-aran"]);
    expect(fresh.area.required).toBe(true);

    const saved = await send(fx, "PUT", "/holiday-area", fx.manager, { areaKey: "aran" });
    expect(saved.status).toBe(200);
    const geography = (await saved.json()) as HolidayGeography;
    const [session] = await db
      .select()
      .from(managementSessions)
      .where(eq(managementSessions.tokenHash, hashSessionToken(fx.manager.split("=")[1]!)));
    expect((await db.select().from(settings))[0]!.updatedBy).toBe(session!.personId);

    expect(geography).toEqual({
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
    const before = await rows();
    const response = await send(fx, "PUT", "/holiday-area", fx.manager, { areaKey: null });
    expect(response.status).toBe(204);
    expect(await rows()).toEqual(before);
  });

  it("refuses a missing or unknown area", async () => {
    const lleida = await fixture({ province: "Lleida", city: "Vielha" });
    const before = await rows();
    for (const body of [{}, { areaKey: "tenerife" }, { areaKey: 7 }])
      await refused(await send(lleida, "PUT", "/holiday-area", lleida.manager, body), 400, {
        code: "holiday.invalid",
        params: { field: "areaKey" },
      });
    expect(await rows()).toEqual(before);
  });

  it("refuses any area where none is sourced", async () => {
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
  const before = await rows();
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
  expect(await rows()).toEqual(before);
});

it("refuses the retained area write to a read-only supervisor, staff, an absent and an expired session", async () => {
  const fx = await fixture({ province: "Lleida", city: "Vielha" });
  const before = await rows();
  for (const cookie of [fx.supervisor, fx.staff])
    await refused(await send(fx, "PUT", "/holiday-area", cookie, { areaKey: "aran" }), 403, {
      code: "authorization.not_permitted",
    });
  await refused(await send(fx, "PUT", "/holiday-area", undefined, { areaKey: "aran" }), 401, {
    code: "management_session.required",
  });
  await refused(await send(fx, "PUT", "/holiday-area", fx.expired, { areaKey: "aran" }), 401, {
    code: "management_session.expired",
  });
  expect(await rows()).toEqual(before);
});

it("refuses a submitted city on the retained area route and writes nothing", async () => {
  const fx = await fixture({ province: "Lleida", city: "Vielha" });
  const before = await rows();
  await refused(
    await send(fx, "PUT", "/holiday-area", fx.manager, { areaKey: null, city: "Vielha" }),
    400,
    { code: "management.request_invalid", params: { field: "city" } },
  );
  expect(await rows()).toEqual(before);
});
it.each([
  { city: null, province: "Lleida" },
  { city: "Vielha", province: null },
  { city: null, province: null },
])("refuses the unresolved address %j at the area route without writes", async (address) => {
  const fx = await fixture(address);
  const before = await rows();
  await refused(await send(fx, "PUT", "/holiday-area", fx.manager, { areaKey: "aran" }), 400, {
    code: "holiday.invalid",
    params: { field: "geography" },
  });
  expect(await rows()).toEqual(before);
});
