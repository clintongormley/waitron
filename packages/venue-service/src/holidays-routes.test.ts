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
import type {
  HolidayGeography,
  HolidayRead,
  LocalHoliday,
  LocalHolidayModel,
} from "./holiday-types.js";
import { readHolidays, saveLocalHoliday } from "./holidays.js";
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
  /** A local holiday of the other venue, for forged-id refusals. */
  otherEntry: LocalHoliday;
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
    const otherEntry = await saveLocalHoliday(tx, other, null, {
      date: "2026-04-21",
      name: "Elsewhere",
    });
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
      otherEntry,
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

async function moveTo(fx: Fixture, address: Address) {
  await db.update(locations).set(address).where(eq(locations.id, fx.cfg.locationId));
}

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

async function create(fx: Fixture, date: string, name: string): Promise<LocalHoliday> {
  const response = await send(fx, "POST", "/local-holidays", fx.manager, { date, name });
  expect(response.status).toBe(201);
  return (await response.json()) as LocalHoliday;
}

describe("reading holidays", () => {
  it("returns the range's holiday read to anyone who may view the venue", async () => {
    const fx = await fixture();
    const feria = await create(fx, "2026-10-20", "Feria de otoño");
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
      ["2026-10-20", "Feria de otoño", "local"],
    ]);
    expect(read.facts[1]!.sourceId).toBe(`owner:${feria.geographyId}`);
    expect(read.coverage).toMatchObject([
      { year: 2026, country: "ES", provinceCode: "41", nationalRegional: "complete" },
    ]);
    expect(read.coverage[0]!.local).toBe("owner_entered");
    expect(read.sources.find(({ kind }) => kind === "owner")).toEqual({
      id: `owner:${feria.geographyId}`,
      kind: "owner",
      title: "Sevilla",
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

  it("gives a fresh venue its address, allowance and no geographies or entries", async () => {
    const fx = await fixture();
    const response = await send(fx, "GET", "/local-holidays", fx.supervisor);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      venue: { country: "ES", provinceCode: "41", city: "Sevilla" },
      localEntryLimit: 2,
      areaOptions: [],
      areaRequired: false,
      geographies: [],
      entries: [],
    } satisfies LocalHolidayModel);
  });

  it("refuses both reads to staff, an absent and an expired session", async () => {
    const fx = await fixture();
    for (const path of ["/holidays?from=2026-10-01&to=2026-10-31", "/local-holidays"]) {
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
    expect(model.days[2]!.holidays).toHaveLength(1);
    expect(model.holidayCoverage).toEqual(expected.coverage);
    expect(model.holidaySources).toEqual(expected.sources);
    expect(model.holidaySources.length).toBeGreaterThan(1);
  });
});

describe("local holiday writes", () => {
  it("creates, edits and deletes an entry for a manager", async () => {
    const fx = await fixture();
    const created = await create(fx, "2026-05-30", "  San Fernando ");
    expect(created).toEqual({
      id: created.id,
      geographyId: created.geographyId,
      date: "2026-05-30",
      name: "San Fernando",
    });
    const edited = await send(fx, "PUT", `/local-holidays/${created.id}`, fx.manager, {
      date: "2026-05-29",
      name: "Corpus",
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toEqual({ ...created, date: "2026-05-29", name: "Corpus" });
    const model = (await (
      await send(fx, "GET", "/local-holidays", fx.manager)
    ).json()) as LocalHolidayModel;
    expect(model.entries).toEqual([{ ...created, date: "2026-05-29", name: "Corpus" }]);
    expect(model.geographies).toEqual([
      {
        id: created.geographyId,
        country: "ES",
        provinceCode: "41",
        city: "Sevilla",
        areaKey: null,
        matchesVenue: true,
      },
    ]);
    const deleted = await send(fx, "DELETE", `/local-holidays/${created.id}`, fx.manager);
    expect(deleted.status).toBe(204);
    expect((await rows(fx)).entries.map(({ id }) => id)).toEqual([fx.otherEntry.id]);
  });

  it("refuses every write to a read-only supervisor, staff, an absent and an expired session", async () => {
    const fx = await fixture();
    const entry = await create(fx, "2026-05-30", "San Fernando");
    await moveTo(fx, { city: "Dos Hermanas" });
    const before = await rows(fx);
    const writes: ["POST" | "PUT" | "DELETE", string, unknown][] = [
      ["POST", "/local-holidays", { date: "2026-06-01", name: "Feria" }],
      ["PUT", `/local-holidays/${entry.id}`, { date: "2026-06-01", name: "Feria" }],
      ["DELETE", `/local-holidays/${entry.id}`, undefined],
      ["DELETE", `/holiday-geographies/${entry.geographyId}`, undefined],
      ["PUT", "/holiday-area", { areaKey: null }],
    ];
    for (const [method, path, body] of writes) {
      for (const cookie of [fx.supervisor, fx.staff])
        await refused(await send(fx, method, path, cookie, body), 403, {
          code: "authorization.not_permitted",
        });
      await refused(await send(fx, method, path, undefined, body), 401, {
        code: "management_session.required",
      });
      await refused(await send(fx, method, path, fx.expired, body), 401, {
        code: "management_session.expired",
      });
    }
    expect(await rows(fx)).toEqual(before);
  });

  it("refuses a submitted city, geography or province instead of choosing the geography from the client", async () => {
    const fx = await fixture();
    const entry = await create(fx, "2026-05-30", "San Fernando");
    const before = await rows(fx);
    const forged = [
      ["POST", "/local-holidays", { date: "2026-06-01", name: "Feria", city: "Madrid" }, "city"],
      [
        "POST",
        "/local-holidays",
        { date: "2026-06-01", name: "Feria", geographyId: fx.otherEntry.geographyId },
        "geographyId",
      ],
      [
        "PUT",
        `/local-holidays/${entry.id}`,
        { date: "2026-06-01", name: "Feria", provinceCode: "28" },
        "provinceCode",
      ],
      ["PUT", "/holiday-area", { areaKey: null, city: "Vielha" }, "city"],
    ] as const;
    for (const [method, path, body, field] of forged)
      await refused(await send(fx, method, path, fx.manager, body), 400, {
        code: "management.request_invalid",
        params: { field },
      });
    expect(await rows(fx)).toEqual(before);
  });

  it("refuses another venue's entry or geography, an unknown one and a malformed id", async () => {
    const fx = await fixture();
    const before = await rows(fx);
    const body = { date: "2026-06-01", name: "Feria" };
    const unknown = randomUUID();
    const entryGone = (holidayId: string) => ({
      code: "holiday.not_found",
      params: { holidayId },
    });
    const geographyGone = (geographyId: string) => ({
      code: "holiday_geography.not_found",
      params: { geographyId },
    });
    for (const [method, path, error] of [
      ["PUT", `/local-holidays/${fx.otherEntry.id}`, entryGone(fx.otherEntry.id)],
      ["DELETE", `/local-holidays/${fx.otherEntry.id}`, entryGone(fx.otherEntry.id)],
      [
        "DELETE",
        `/holiday-geographies/${fx.otherEntry.geographyId}`,
        geographyGone(fx.otherEntry.geographyId),
      ],
      ["PUT", `/local-holidays/${unknown}`, entryGone(unknown)],
      ["DELETE", `/holiday-geographies/${unknown}`, geographyGone(unknown)],
    ] as const)
      await refused(
        await send(fx, method, path, fx.manager, method === "PUT" ? body : undefined),
        404,
        error,
      );
    for (const [method, path] of [
      ["PUT", "/local-holidays/not-a-uuid"],
      ["DELETE", "/local-holidays/not-a-uuid"],
      ["DELETE", "/holiday-geographies/not-a-uuid"],
    ] as const)
      await refused(
        await send(fx, method, path, fx.manager, method === "PUT" ? body : undefined),
        400,
        { code: "shared.invalid_id" },
      );
    expect(await rows(fx)).toEqual(before);
  });

  it("refuses a bad date or name, a taken date and an entry past the allowance, writing nothing", async () => {
    const fx = await fixture();
    const first = await create(fx, "2026-05-30", "San Fernando");
    await create(fx, "2026-06-04", "Corpus");
    const before = await rows(fx);
    const cases = [
      [{ date: "2026-02-30", name: "Feria" }, 400, "holiday.invalid", { field: "date" }],
      [{ name: "Feria" }, 400, "holiday.invalid", { field: "date" }],
      [{ date: "2027-03-01", name: "   " }, 400, "holiday.invalid", { field: "name" }],
      [{ date: "2027-03-01", name: "x".repeat(201) }, 400, "holiday.invalid", { field: "name" }],
      [{ date: "2026-05-30", name: "Other" }, 409, "holiday.date_taken", { date: "2026-05-30" }],
      [{ date: "2026-09-08", name: "Feria" }, 409, "holiday.local_limit", { limit: 2, year: 2026 }],
    ] as const;
    for (const [body, status, code, params] of cases)
      await refused(await send(fx, "POST", "/local-holidays", fx.manager, body), status, {
        code,
        params,
      });
    await refused(
      await send(fx, "PUT", `/local-holidays/${first.id}`, fx.manager, {
        date: "2026-06-04",
        name: "Moved",
      }),
      409,
      { code: "holiday.date_taken", params: { date: "2026-06-04" } },
    );
    expect(await rows(fx)).toEqual(before);
    // The allowance is per civil year: another year still has room.
    expect((await create(fx, "2027-05-30", "San Fernando")).date).toBe("2027-05-30");
  });

  it("refuses to save without a resolved address, before checking an old entry's geography", async () => {
    const fx = await fixture();
    const entry = await create(fx, "2026-05-30", "San Fernando");
    for (const address of [{ city: null }, { city: "  " }, { province: "Atlantis" }]) {
      await moveTo(fx, { province: "Sevilla", city: "Sevilla", ...address });
      const before = await rows(fx);
      await refused(
        await send(fx, "POST", "/local-holidays", fx.manager, { date: "2026-06-01", name: "F" }),
        400,
        { code: "holiday.invalid", params: { field: "geography" } },
      );
      await refused(
        await send(fx, "PUT", `/local-holidays/${entry.id}`, fx.manager, {
          date: "2026-06-01",
          name: "F",
        }),
        400,
        { code: "holiday.invalid", params: { field: "geography" } },
      );
      await refused(await send(fx, "PUT", "/holiday-area", fx.manager, { areaKey: null }), 400, {
        code: "holiday.invalid",
        params: { field: "geography" },
      });
      expect(await rows(fx)).toEqual(before);
    }
  });

  it("hides an old address's entries, keeps its geography as a notice, and restores both on matching again", async () => {
    const fx = await fixture();
    const kept = await create(fx, "2026-05-30", "San Fernando");
    const dropped = await create(fx, "2026-06-04", "Corpus");
    const local = async () =>
      (await (await send(fx, "GET", "/local-holidays", fx.supervisor)).json()) as LocalHolidayModel;

    await moveTo(fx, { city: "Dos Hermanas" });
    const moved = await local();
    expect(moved.entries).toEqual([]);
    expect(moved.geographies).toEqual([
      {
        id: kept.geographyId,
        country: "ES",
        provinceCode: "41",
        city: "Sevilla",
        areaKey: null,
        matchesVenue: false,
      },
    ] satisfies HolidayGeography[]);
    const read = (await (
      await send(fx, "GET", "/holidays?from=2026-05-01&to=2026-06-30", fx.supervisor)
    ).json()) as HolidayRead;
    expect(read.facts.filter(({ scope }) => scope === "local")).toEqual([]);
    expect(read.coverage[0]!.local).toBe("none_entered");

    await refused(
      await send(fx, "PUT", `/local-holidays/${kept.id}`, fx.manager, {
        date: "2026-05-30",
        name: "Renamed",
      }),
      400,
      { code: "holiday.invalid", params: { field: "id" } },
    );
    // A retained entry can still be deleted through its own geography.
    expect((await send(fx, "DELETE", `/local-holidays/${dropped.id}`, fx.manager)).status).toBe(
      204,
    );

    await moveTo(fx, { city: " SEVILLA " });
    const back = await local();
    expect(back.entries).toEqual([kept]);
    expect(back.geographies.map(({ id, matchesVenue }) => [id, matchesVenue])).toEqual([
      [kept.geographyId, true],
    ]);
  });

  it("deletes a retained geography with its entries, and refuses the address's own", async () => {
    const fx = await fixture();
    const entry = await create(fx, "2026-05-30", "San Fernando");
    await refused(
      await send(fx, "DELETE", `/holiday-geographies/${entry.geographyId}`, fx.manager),
      409,
      { code: "holiday.geography_current", params: { geographyId: entry.geographyId } },
    );
    await moveTo(fx, { city: "Dos Hermanas" });
    const response = await send(
      fx,
      "DELETE",
      `/holiday-geographies/${entry.geographyId}`,
      fx.manager,
    );
    expect(response.status).toBe(204);
    const left = await rows(fx);
    expect(left.geographies.map(({ id }) => id)).toEqual([fx.otherEntry.geographyId]);
    expect(left.entries.map(({ id }) => id)).toEqual([fx.otherEntry.id]);
  });
});

describe("holiday area", () => {
  it("offers Lleida's sourced areas, saves a choice and clears it", async () => {
    const fx = await fixture({ province: "Lleida", city: "Vielha" });
    const local = async () =>
      (await (await send(fx, "GET", "/local-holidays", fx.manager)).json()) as LocalHolidayModel;
    const fresh = await local();
    expect(fresh.areaOptions.map(({ key }) => key)).toEqual(["aran", "lleida-except-aran"]);
    expect(fresh.areaRequired).toBe(true);

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
    expect((await local()).areaRequired).toBe(false);

    const cleared = await send(fx, "PUT", "/holiday-area", fx.manager, { areaKey: null });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ ...geography, areaKey: null });
    expect((await local()).areaRequired).toBe(true);
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
