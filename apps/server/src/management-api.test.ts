import type { ModuleRouteContext } from "@waitron/module";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  floorZones,
  kitchenCourses,
  kitchenStations,
  kitchenStationTiming,
  locations,
  parties,
  partyTables,
  printers,
  products,
  stationPrinters,
  watcherPrinters,
  withTransaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons, registerModulePermissions } from "@waitron/identity";
import { createCatalogue, createCategory, createProduct } from "@waitron/catalogue";
import {
  WEEK_DISPLAY_ORDER,
  deleteSpecialDate,
  readWeekHours,
  replaceWeekHours,
  saveSpecialDate,
  stationStates,
} from "@waitron/venue-service";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import {
  configureZone,
  createDepartment,
  deactivateDepartment,
  VENUE_SERVICE_ROUTES,
  VENUE_SERVICE_PERMISSIONS,
} from "@waitron/venue-service";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { mountManagementApi } from "./management-api.js";
import { generateSync } from "otplib";
import { enrolAuthenticator, TOTP_KEY_RING, wrongTotpCode } from "./testing/authenticator.js";
import { writerBesideRequest, whileSuspendingOnLockRequest } from "./testing/watched-scrypt.js";

/**
 * Floor zones, dining tables, table placement, kitchen stations and kitchen courses on the
 * `/management-api` surface, end to end over HTTP with the manager and staff sessions a real
 * sign-in mints.
 *
 * The malformed-id and malformed-`zoneId` cases pin the response only: a `text` id column matches no
 * row for a malformed id, so none of them tells its screen from its absence.
 */

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

// No real role holds `venue.configure` without `printer.manage`, so a test can refuse that one
// permission while every other check stays real.
const printerGate = vi.hoisted(() => ({ deny: false }));
vi.mock("@waitron/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/identity")>();
  const { AppError } = await import("@waitron/shared");
  return {
    ...actual,
    authorizeManager: async (...args: Parameters<typeof actual.authorizeManager>) => {
      if (printerGate.deny && args[1].permission === "printer.manage") {
        throw new AppError("authorization.not_permitted", { permission: "printer.manage" });
      }
      return actual.authorizeManager(...args);
    },
  };
});

registerModulePermissions(VENUE_SERVICE_PERMISSIONS);

const LOCALE = "es-ES";
const PASSWORD = "correct horse";
const MANAGER_EMAIL = "manager@x.com";
const STAFF_EMAIL = "clerk@x.com";
const SUPERVISOR_EMAIL = "supervisor@x.com";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

const noopLog: Logger = () => {};

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(74_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Names are unique and the database is not reset between tests, so every list assertion is a
 *  membership check. */
function unique(base: string): string {
  return `${base}-${randomUUID().slice(0, 8)}`;
}

async function setupTenant(): Promise<{ venue: VenueResult; managerId: string; staffId: string }> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Deli Test SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );

  // Through the table definition: `persons.id` and `persons.created_at` are `$defaultFn`
  // generators, which a raw SQL insert never reaches.
  const { managerId, staffId } = await withTransaction(suite.db, async (tx) => {
    const seed = async (
      displayName: string,
      email: string,
      role: "manager" | "staff" | "supervisor",
    ) => {
      const [person] = await tx
        .insert(persons)
        .values({
          displayName,
          email,
          pinHash: hashPin("1234"),
          passwordHash: hashPassword(PASSWORD),
          role,
        })
        .returning({ id: persons.id });
      return person!.id;
    };
    await seed("The Supervisor", SUPERVISOR_EMAIL, "supervisor");
    return {
      managerId: await seed("The Manager", MANAGER_EMAIL, "manager"),
      staffId: await seed("The Clerk", STAFF_EMAIL, "staff"),
    };
  });
  return { venue, managerId, staffId };
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
}

function mountApp(venue: VenueResult): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: venue.nodeId },
      venueCfg: tillConfigFromVenue(venue),
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
      credentialKeyRing: TOTP_KEY_RING,
    },
    noopLog,
  );
  VENUE_SERVICE_ROUTES.mount(
    app,
    { db: suite.db, cfg: tillConfigFromVenue(venue), core: {} as ModuleRouteContext["core"] },
    noopLog,
  );
  return app;
}

async function login(app: Hono, email: string): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

let app: Hono;
let venue: VenueResult;
let managerCookie: string;
let staffCookie: string;
let supervisorCookie: string;
let testDepartmentId: string;
const json = { "content-type": "application/json" };

beforeAll(async () => {
  const setup = await setupTenant();
  venue = setup.venue;
  testDepartmentId = (
    await withTransaction(suite.db, (tx) =>
      createDepartment(tx, tillConfigFromVenue(venue), {
        name: unique("Test department"),
        orderStart: "table",
      }),
    )
  ).id;
  app = mountApp(venue);
  managerCookie = await login(app, MANAGER_EMAIL);
  staffCookie = await login(app, STAFF_EMAIL);
  supervisorCookie = await login(app, SUPERVISOR_EMAIL);
});

async function req(path: string, init: RequestInit, cookie?: string): Promise<Response> {
  if (path === "/venue-service/zones" && init.method === "POST" && typeof init.body === "string") {
    const body: unknown = JSON.parse(init.body);
    if (body !== null && typeof body === "object" && !Array.isArray(body)) {
      init = { ...init, body: JSON.stringify({ departmentId: testDepartmentId, ...body }) };
    }
  }
  return app.request(`/management-api${path}`, {
    ...init,
    headers: { ...json, ...(cookie ? { cookie } : {}), ...init.headers },
  });
}

it("lets a supervisor read Tables and Kitchen settings while refusing edits", async () => {
  for (const path of ["/service-statuses", "/bump-mode", "/courses", "/fire-control"]) {
    const response = await req(path, { method: "GET" }, supervisorCookie);
    expect(response.status, path).toBe(200);
  }
  for (const [path, method, body] of [
    ["/service-statuses", "POST", { label: unique("Denied"), color: "#fff" }],
    ["/bump-mode", "PUT", { mode: "ticket" }],
    ["/courses", "POST", { name: unique("Denied") }],
    ["/fire-control", "PUT", { mode: "expo" }],
  ] as const) {
    const response = await req(path, { method, body: JSON.stringify(body) }, supervisorCookie);
    expect(response.status, path).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  }
  expect((await req("/service-statuses", { method: "GET" }, managerCookie)).status).toBe(200);
});

async function createZone(name: string): Promise<string> {
  const res = await req(
    "/venue-service/zones",
    { method: "POST", body: JSON.stringify({ name }) },
    managerCookie,
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe("/management-api/watchers", () => {
  const body = {
    name: "Pass",
    everyStation: true,
    stationIds: [],
    everyZone: true,
    zoneIds: [],
    runsPass: true,
    displayOrder: 3,
  };
  it("creates, lists, replaces, and removes a watcher over HTTP", async () => {
    const created = await req(
      "/watchers",
      { method: "POST", body: JSON.stringify({ ...body, name: unique("Pass") }) },
      managerCookie,
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const list = await req("/watchers", { method: "GET" }, managerCookie);
    expect(list.status).toBe(200);
    expect(await list.json()).toContainEqual(
      expect.objectContaining({ id, runsPass: true, everyZone: true }),
    );
    const updated = await req(
      `/watchers/${id}`,
      { method: "PUT", body: JSON.stringify({ ...body, name: unique("Runner"), runsPass: false }) },
      managerCookie,
    );
    expect(updated.status).toBe(204);
    const removed = await req(`/watchers/${id}`, { method: "DELETE" }, managerCookie);
    expect(removed.status).toBe(204);
    expect(
      await (await req("/watchers", { method: "GET" }, managerCookie)).json(),
    ).not.toContainEqual(expect.objectContaining({ id }));
  });
  it("refuses malformed watcher bodies with the offending field", async () => {
    for (const [patch, field] of [
      [null, "body"],
      [{ ...body, name: 3 }, "name"],
      [{ ...body, everyStation: "yes" }, "everyStation"],
      [{ ...body, stationIds: [3] }, "stationIds"],
      [{ ...body, everyZone: null }, "everyZone"],
      [{ ...body, zoneIds: [3] }, "zoneIds"],
      [{ ...body, runsPass: 1 }, "runsPass"],
      [{ ...body, displayOrder: 0.5 }, "displayOrder"],
    ] as const) {
      const res = await req(
        "/watchers",
        { method: "POST", body: JSON.stringify(patch) },
        managerCookie,
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
  });
  it("refuses a staff session the watcher list and a new watcher (403), and the list to no session (401)", async () => {
    expect((await req("/watchers", { method: "GET" })).status).toBe(401);
    expect((await req("/watchers", { method: "GET" }, staffCookie)).status).toBe(403);
    expect(
      (await req("/watchers", { method: "POST", body: JSON.stringify(body) }, staffCookie)).status,
    ).toBe(403);
  });
  it("lets a supervisor list watchers, disabled ones included, while refusing a new one", async () => {
    for (const path of ["/watchers", "/watchers?includeDisabled=true"]) {
      const response = await req(path, { method: "GET" }, supervisorCookie);
      expect(response.status, path).toBe(200);
      expect(Array.isArray(await response.json()), path).toBe(true);
    }
    const refused = await req(
      "/watchers",
      { method: "POST", body: JSON.stringify({ ...body, name: unique("Denied") }) },
      supervisorCookie,
    );
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({
      error: { code: "authorization.not_permitted", params: { permission: "venue.configure" } },
    });
  });
  it("returns watcher.not_found for malformed and absent route ids", async () => {
    for (const id of ["bad", randomUUID()]) {
      const res = await req(`/watchers/${id}`, { method: "DELETE" }, managerCookie);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        error: { code: "watcher.not_found", params: { watcherId: id } },
      });
    }
  });

  async function createWatcher(name: string): Promise<string> {
    const res = await req(
      "/watchers",
      { method: "POST", body: JSON.stringify({ ...body, name }) },
      managerCookie,
    );
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  /** A switched-off kitchen screen still naming the watcher, so the watcher is in use. */
  async function listWatchers(
    query = "",
  ): Promise<{ id: string; active: boolean; inUse: boolean }[]> {
    const res = await req(`/watchers${query}`, { method: "GET" }, managerCookie);
    expect(res.status).toBe(200);
    return (await res.json()) as { id: string; active: boolean; inUse: boolean }[];
  }

  it("deletes a watcher, and disables one when asked, which only the disabled list shows; no device keeps one in use", async () => {
    const unused = await createWatcher(unique("Unused"));
    const kept = await createWatcher(unique("Kept"));
    expect((await listWatchers()).every((w) => !("inUse" in w))).toBe(true);
    expect(await listWatchers("?includeDisabled=true")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: unused, active: true, inUse: false }),
        expect.objectContaining({ id: kept, active: true, inUse: false }),
      ]),
    );
    expect((await req(`/watchers/${unused}`, { method: "DELETE" }, managerCookie)).status).toBe(
      204,
    );
    expect(
      (await req(`/watchers/${kept}?disable=true`, { method: "DELETE" }, managerCookie)).status,
    ).toBe(204);
    const active = (await listWatchers()).map((w) => w.id);
    expect(active).not.toContain(unused);
    expect(active).not.toContain(kept);
    const all = await listWatchers("?includeDisabled=true");
    expect(all.find((w) => w.id === unused)).toBeUndefined();
    expect(all.find((w) => w.id === kept)).toMatchObject({ active: false, inUse: false });
    expect(all.every((w) => typeof w.inUse === "boolean")).toBe(true);
    expect((await req(`/watchers/${kept}`, { method: "DELETE" }, managerCookie)).status).toBe(204);
    expect(
      (await listWatchers("?includeDisabled=true")).find((w) => w.id === kept),
    ).toBeUndefined();
  });

  it("enables a disabled watcher as itself; refuses a taken name, an unknown id and a staff session", async () => {
    const name = unique("Again");
    const id = await createWatcher(name);
    await req(`/watchers/${id}?disable=true`, { method: "DELETE" }, managerCookie);
    const taker = await createWatcher(name);
    const taken = await req(`/watchers/${id}/reactivate`, { method: "POST" }, managerCookie);
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({
      error: { code: "watcher.name_taken", params: { name } },
    });
    expect((await listWatchers("?includeDisabled=true")).find((w) => w.id === id)).toMatchObject({
      active: false,
    });
    expect((await req(`/watchers/${taker}`, { method: "DELETE" }, managerCookie)).status).toBe(204);
    expect((await req(`/watchers/${id}/reactivate`, { method: "POST" }, staffCookie)).status).toBe(
      403,
    );
    expect((await req(`/watchers/${id}/reactivate`, { method: "POST" })).status).toBe(401);
    const enabled = await req(`/watchers/${id}/reactivate`, { method: "POST" }, managerCookie);
    expect(enabled.status).toBe(204);
    expect((await listWatchers("?includeDisabled=true")).find((w) => w.id === id)).toMatchObject({
      name,
      active: true,
      inUse: false,
      runsPass: true,
      displayOrder: 3,
    });
    expect(
      (await req(`/watchers/${id}/reactivate`, { method: "POST" }, managerCookie)).status,
    ).toBe(204);
    for (const missing of ["bad", randomUUID()]) {
      const res = await req(`/watchers/${missing}/reactivate`, { method: "POST" }, managerCookie);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        error: { code: "watcher.not_found", params: { watcherId: missing } },
      });
    }
  });

  it("DELETE ?disable=true keeps a watcher nothing refers to, disabled and without its printers", async () => {
    const id = await createWatcher(unique("Kept"));
    await withTransaction(suite.db, async (tx) => {
      const [printer] = await tx
        .insert(printers)
        .values({
          locationId: venue.locationId,
          name: unique("Copy"),
          transport: "network_tcp",
          host: "10.0.0.9",
        })
        .returning({ id: printers.id });
      await tx.insert(watcherPrinters).values({ printerId: printer!.id, watcherId: id });
    });
    const refused = await req(`/watchers/${id}?disable=yes`, { method: "DELETE" }, managerCookie);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "disable" } },
    });
    expect((await listWatchers("?includeDisabled=true")).find((w) => w.id === id)).toMatchObject({
      active: true,
      inUse: false,
      printerIds: [expect.any(String)],
    });
    const res = await req(`/watchers/${id}?disable=true`, { method: "DELETE" }, managerCookie);
    expect(res.status).toBe(204);
    expect((await listWatchers("?includeDisabled=true")).find((w) => w.id === id)).toMatchObject({
      active: false,
      inUse: false,
      printerIds: [],
    });
  });
});

describe("/management-api/zones", () => {
  it("refuses the retired department-less zone creation route without writing a zone", async () => {
    const name = unique("No department");
    const response = await req(
      "/zones",
      { method: "POST", body: JSON.stringify({ name }) },
      managerCookie,
    );
    expect(response.status).toBe(404);
    const list = (await (await req("/zones", { method: "GET" }, managerCookie)).json()) as {
      name: string;
    }[];
    expect(list.some((z) => z.name === name)).toBe(false);
  });

  it.each([-2_147_483_648, -1, 2_147_483_647])(
    "zone creation keeps the signed displayOrder %s",
    async (displayOrder) => {
      const response = await req(
        "/venue-service/zones",
        {
          method: "POST",
          body: JSON.stringify({ name: unique("Signed order"), displayOrder }),
        },
        managerCookie,
      );
      expect(response.status).toBe(201);
      const { id } = (await response.json()) as { id: string };
      const zones = (await (await req("/zones", { method: "GET" }, managerCookie)).json()) as {
        id: string;
        displayOrder: number;
      }[];
      expect(zones.find((zone) => zone.id === id)?.displayOrder).toBe(displayOrder);
    },
  );
  it.each([-2_147_483_649, 2_147_483_648, 1e300])(
    "zone creation refuses out-of-range displayOrder %s",
    async (displayOrder) => {
      const name = unique("Order refused");
      const response = await req(
        "/venue-service/zones",
        {
          method: "POST",
          body: JSON.stringify({ name, displayOrder }),
        },
        managerCookie,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "displayOrder" } },
      });
      const zones = (await (await req("/zones", { method: "GET" }, managerCookie)).json()) as {
        name: string;
      }[];
      expect(zones.some((zone) => zone.name === name)).toBe(false);
    },
  );

  it("POST creates (201 { id }) + GET lists it (manager)", async () => {
    const name = unique("Comedor");
    const create = await req(
      "/venue-service/zones",
      { method: "POST", body: JSON.stringify({ name, displayOrder: 2 }) },
      managerCookie,
    );
    expect(create.status).toBe(201);
    const { id } = (await create.json()) as { id: string };
    expect(id).toBeDefined();

    const list = (await (await req("/zones", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      name: string;
      displayOrder: number;
      active: boolean;
    }[];
    expect(list.find((z) => z.id === id)).toMatchObject({ name, displayOrder: 2, active: true });
  });

  it("POST without displayOrder defaults it to 0", async () => {
    const name = unique("Terraza");
    const { id } = (await (
      await req(
        "/venue-service/zones",
        { method: "POST", body: JSON.stringify({ name }) },
        managerCookie,
      )
    ).json()) as { id: string };
    const list = (await (await req("/zones", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      displayOrder: number;
    }[];
    expect(list.find((z) => z.id === id)).toMatchObject({ displayOrder: 0 });
  });

  it("POST with a duplicate name → 409 zone.name_taken", async () => {
    const name = unique("Barra");
    await req(
      "/venue-service/zones",
      { method: "POST", body: JSON.stringify({ name }) },
      managerCookie,
    );
    const dup = await req(
      "/venue-service/zones",
      { method: "POST", body: JSON.stringify({ name }) },
      managerCookie,
    );
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: { code: "zone.name_taken" } });
  });

  it("POST body screens: null → field name, array → field body, non-string name, bad displayOrder", async () => {
    const nullBody = await req(
      "/venue-service/zones",
      { method: "POST", body: "null" },
      managerCookie,
    );
    expect(nullBody.status).toBe(400);
    expect(await nullBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "name" } },
    });

    const arrayBody = await req(
      "/venue-service/zones",
      { method: "POST", body: "[]" },
      managerCookie,
    );
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });

    const badName = await req(
      "/venue-service/zones",
      { method: "POST", body: JSON.stringify({ name: 123 }) },
      managerCookie,
    );
    expect(badName.status).toBe(400);
    expect(await badName.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "name" } },
    });

    const badOrder = await req(
      "/venue-service/zones",
      { method: "POST", body: JSON.stringify({ name: unique("X"), displayOrder: 1.5 }) },
      managerCookie,
    );
    expect(badOrder.status).toBe(400);
    expect(await badOrder.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "displayOrder" } },
    });
  });

  it("PATCH edits name/displayOrder/active (204), then GET reflects it", async () => {
    const id = await createZone(unique("Reservados"));
    const newName = unique("Reservados-edited");
    const patch = await req(
      `/zones/${id}`,
      { method: "PATCH", body: JSON.stringify({ name: newName, displayOrder: 7, active: true }) },
      managerCookie,
    );
    expect(patch.status).toBe(204);
    expect(await patch.text()).toBe("");

    const list = (await (await req("/zones", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      name: string;
      displayOrder: number;
    }[];
    expect(list.find((z) => z.id === id)).toMatchObject({ name: newName, displayOrder: 7 });
  });

  it("PATCH an unknown id → 404 zone.not_found; a malformed :id → 404 too (isUuid guard)", async () => {
    const unknown = await req(
      "/zones/00000000-0000-4000-8000-000000000000",
      { method: "PATCH", body: JSON.stringify({ name: unique("X") }) },
      managerCookie,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "zone.not_found" } });

    const malformed = await req(
      "/zones/not-a-uuid",
      { method: "PATCH", body: JSON.stringify({ name: unique("X") }) },
      managerCookie,
    );
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({ error: { code: "zone.not_found" } });
  });

  it("PATCH body screens: array → body; non-string name; bad displayOrder; non-boolean active", async () => {
    const id = randomUUID();

    const arrayBody = await req(`/zones/${id}`, { method: "PATCH", body: "[]" }, managerCookie);
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });

    const badName = await req(
      `/zones/${id}`,
      { method: "PATCH", body: JSON.stringify({ name: 123 }) },
      managerCookie,
    );
    expect(badName.status).toBe(400);
    expect(await badName.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "name" } },
    });

    const badOrder = await req(
      `/zones/${id}`,
      { method: "PATCH", body: JSON.stringify({ displayOrder: "x" }) },
      managerCookie,
    );
    expect(badOrder.status).toBe(400);
    expect(await badOrder.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "displayOrder" } },
    });

    const badActive = await req(
      `/zones/${id}`,
      { method: "PATCH", body: JSON.stringify({ active: "yes" }) },
      managerCookie,
    );
    expect(badActive.status).toBe(400);
    expect(await badActive.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "active" } },
    });
  });

  it("PATCH with a null / empty body → 204 no-op (never a 500)", async () => {
    const id = await createZone(unique("Unchanged"));
    const nullBody = await req(`/zones/${id}`, { method: "PATCH", body: "null" }, managerCookie);
    expect(nullBody.status).toBe(204);
    expect(await nullBody.text()).toBe("");
    const emptyBody = await req(`/zones/${id}`, { method: "PATCH", body: "{}" }, managerCookie);
    expect(emptyBody.status).toBe(204);
  });

  it("DELETE deactivates a zone (204); GET drops it; PATCH active:true restores it", async () => {
    const name = unique("ToRetire");
    const id = await createZone(name);

    const del = await req(`/zones/${id}`, { method: "DELETE" }, managerCookie);
    expect(del.status).toBe(204);
    expect(await del.text()).toBe("");

    const afterDel = (await (await req("/zones", { method: "GET" }, managerCookie)).json()) as {
      id: string;
    }[];
    expect(afterDel.find((z) => z.id === id)).toBeUndefined();
    const forManagement = (await (
      await req("/zones?includeInactive=true", { method: "GET" }, managerCookie)
    ).json()) as { id: string; active: boolean }[];
    expect(forManagement.find((z) => z.id === id)).toMatchObject({ active: false });

    // Reactivating via PATCH shows it was a soft delete.
    await req(
      `/zones/${id}`,
      { method: "PATCH", body: JSON.stringify({ active: true }) },
      managerCookie,
    );
    const afterRestore = (await (await req("/zones", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      name: string;
    }[];
    expect(afterRestore.find((z) => z.id === id)).toMatchObject({ name });
  });

  it("DELETE reports the occupied table's name when a zone has an open party", async () => {
    const zoneId = await createZone(unique("Occupied"));
    const label = unique("T7");
    const table = (await (
      await req(
        "/tables",
        { method: "POST", body: JSON.stringify({ label, zoneId }) },
        managerCookie,
      )
    ).json()) as { id: string };
    await withTransaction(suite.db, async (tx) => {
      const [party] = await tx
        .insert(parties)
        .values({ openedBy: randomUUID() })
        .returning({ id: parties.id });
      await tx.insert(partyTables).values({ partyId: party!.id, tableId: table.id });
    });

    const response = await req(`/zones/${zoneId}`, { method: "DELETE" }, managerCookie);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "zone.table_in_use", params: { zoneId, tableId: table.id, tableName: label } },
    });
  });

  it("DELETE an unknown id → 404 zone.not_found; a malformed :id → 404 too", async () => {
    const unknown = await req(
      "/zones/00000000-0000-4000-8000-000000000000",
      { method: "DELETE" },
      managerCookie,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "zone.not_found" } });

    const malformed = await req("/zones/not-a-uuid", { method: "DELETE" }, managerCookie);
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({ error: { code: "zone.not_found" } });
  });

  it("a STAFF session is refused on every zone route (403 authorization.not_permitted)", async () => {
    // A staff person can log in but holds no `venue.configure`.
    const someId = randomUUID();
    const cases = [
      req("/zones", { method: "GET" }, staffCookie),
      req(
        "/venue-service/zones",
        { method: "POST", body: JSON.stringify({ name: unique("Nope") }) },
        staffCookie,
      ),
      req(
        `/zones/${someId}`,
        { method: "PATCH", body: JSON.stringify({ name: unique("Z") }) },
        staffCookie,
      ),
      req(`/zones/${someId}`, { method: "DELETE" }, staffCookie),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    }
  });

  it("no session → 401 management_session.required on every zone route", async () => {
    const someId = randomUUID();
    const cases = [
      req("/zones", { method: "GET" }, undefined),
      req(
        "/venue-service/zones",
        { method: "POST", body: JSON.stringify({ name: "Nope" }) },
        undefined,
      ),
      req(`/zones/${someId}`, { method: "PATCH", body: JSON.stringify({ name: "Z" }) }, undefined),
      req(`/zones/${someId}`, { method: "DELETE" }, undefined),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "management_session.required" } });
    }
  });
});

describe("POST /management-api/session (email login)", () => {
  it("logs in with email + password and sets the cookie", async () => {
    const res = await app.request("/management-api/session", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: MANAGER_EMAIL, password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/management/i);
  });

  it("unknown email returns 401 password.invalid, no cookie", async () => {
    // An unknown email gets the same `password.invalid` as a wrong password.
    const res = await app.request("/management-api/session", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: "ghost@x.com", password: PASSWORD }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "password.invalid" } });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("answers every refused sign-in identically, whatever the cause, and sets no cookie", async () => {
    const seedManager = (email: string, status: "active" | "suspended") =>
      withTransaction(suite.db, async (tx) => {
        const [person] = await tx
          .insert(persons)
          .values({
            displayName: unique("Manager"),
            email,
            pinHash: hashPin("1234"),
            passwordHash: hashPassword(PASSWORD),
            role: "manager",
            status,
          })
          .returning({ id: persons.id });
        return person!.id;
      });
    const suspendedEmail = `${unique("suspended")}@x.com`;
    await seedManager(suspendedEmail, "suspended");
    const twoStepEmail = `${unique("two-step")}@x.com`;
    const twoStepId = await seedManager(twoStepEmail, "active");
    const secret = await enrolAuthenticator(suite.db, twoStepId, PASSWORD, TOTP_KEY_RING);

    const causes: Record<string, Record<string, unknown>> = {
      unknown: { email: `${unique("ghost")}@x.com`, password: PASSWORD },
      // The suspended manager's own password, so only the suspension can be the cause.
      suspended: { email: suspendedEmail, password: PASSWORD },
      wrongPassword: { email: twoStepEmail, password: "wrong", totp: generateSync({ secret }) },
      wrongCode: { email: twoStepEmail, password: PASSWORD, totp: wrongTotpCode(secret) },
    };
    const answers: Record<string, unknown> = {};
    for (const [cause, body] of Object.entries(causes)) {
      const res = await app.request("/management-api/session", {
        method: "POST",
        headers: json,
        body: JSON.stringify(body),
      });
      answers[cause] = {
        status: res.status,
        body: await res.json(),
        cookie: res.headers.get("set-cookie"),
      };
    }
    const refused = {
      status: 401,
      body: { error: { code: "password.invalid", params: {} } },
      cookie: null,
    };
    expect(answers).toEqual({
      unknown: refused,
      suspended: refused,
      wrongPassword: refused,
      wrongCode: refused,
    });
  });

  it("lets another writer commit while it derives the key", async () => {
    const { result, order } = await writerBesideRequest(suite.db, async () =>
      app.request("/management-api/session", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ email: MANAGER_EMAIL, password: PASSWORD }),
      }),
    );

    expect(result.status).toBe(200);
    expect(order.slice(0, 2)).toEqual(["writer", "request's transaction"]);
  });

  it("refuses a manager suspended while the key was being derived, as any refusal", async () => {
    const email = `${unique("suspended-mid-sign-in")}@x.com`;
    const personId = await withTransaction(suite.db, async (tx) => {
      const [person] = await tx
        .insert(persons)
        .values({
          displayName: unique("Manager"),
          email,
          pinHash: hashPin("1234"),
          passwordHash: hashPassword(PASSWORD),
          role: "manager",
        })
        .returning({ id: persons.id });
      return person!.id;
    });

    const res = await whileSuspendingOnLockRequest(suite.db, personId, async () =>
      app.request("/management-api/session", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ email, password: PASSWORD }),
      }),
    );

    expect({
      status: res.status,
      body: await res.json(),
      cookie: res.headers.get("set-cookie"),
    }).toEqual({
      status: 401,
      body: { error: { code: "password.invalid", params: {} } },
      cookie: null,
    });
  });
});

describe("/management-api/tables", () => {
  it("POST creates (201 { id }) + GET lists it (manager)", async () => {
    const label = unique("4");
    const create = await req(
      "/tables",
      { method: "POST", body: JSON.stringify({ label, capacity: 4 }) },
      managerCookie,
    );
    expect(create.status).toBe(201);
    const { id } = (await create.json()) as { id: string };
    expect(id).toBeDefined();

    const list = (await (await req("/tables", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      label: string;
      capacity: number | null;
      active: boolean;
    }[];
    expect(list.find((t) => t.id === id)).toMatchObject({ label, capacity: 4, active: true });
  });

  it("GET projects a placed table's FP-2 placement columns (posX/posY/shape/rotation)", async () => {
    // Real values, so the case cannot pass on nulls.
    const zoneId = await createZone(unique("GetPlaceZone"));
    const { id } = (await (
      await req(
        "/tables",
        { method: "POST", body: JSON.stringify({ label: unique("gp") }) },
        managerCookie,
      )
    ).json()) as { id: string };
    const put = await req(
      `/tables/${id}/placement`,
      {
        method: "PUT",
        body: JSON.stringify({ zoneId, posX: 500, posY: 250, shape: "square", rotation: 15 }),
      },
      managerCookie,
    );
    expect(put.status).toBe(204);

    const list = (await (await req("/tables", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      posX: number | null;
      posY: number | null;
      shape: string | null;
      rotation: number | null;
    }[];
    expect(list.find((t) => t.id === id)).toMatchObject({
      posX: 500,
      posY: 250,
      shape: "square",
      rotation: 15,
    });
  });

  it("POST with a duplicate label → 409 table.label_taken", async () => {
    const label = unique("dup");
    await req("/tables", { method: "POST", body: JSON.stringify({ label }) }, managerCookie);
    const dup = await req(
      "/tables",
      { method: "POST", body: JSON.stringify({ label }) },
      managerCookie,
    );
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: { code: "table.label_taken" } });
  });

  it("POST with a zoneId that names no zone → 404 zone.not_found", async () => {
    const res = await req(
      "/tables",
      {
        method: "POST",
        body: JSON.stringify({
          label: unique("z"),
          zoneId: "00000000-0000-4000-8000-000000000000",
        }),
      },
      managerCookie,
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "zone.not_found" } });
  });

  it("POST with a MALFORMED zoneId → 404 zone.not_found (the isUuid guard)", async () => {
    const res = await req(
      "/tables",
      { method: "POST", body: JSON.stringify({ label: unique("z"), zoneId: "not-a-uuid" }) },
      managerCookie,
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "zone.not_found" } });
  });

  it("POST body screens: null → field label, array → field body, non-string label/zoneId, bad capacity", async () => {
    // A `null` body is read as `{}`, so the label screen fires, not the "body" one.
    const nullBody = await req("/tables", { method: "POST", body: "null" }, managerCookie);
    expect(nullBody.status).toBe(400);
    expect(await nullBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "label" } },
    });

    const arrayBody = await req("/tables", { method: "POST", body: "[]" }, managerCookie);
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });

    const badLabel = await req(
      "/tables",
      { method: "POST", body: JSON.stringify({ label: 123 }) },
      managerCookie,
    );
    expect(badLabel.status).toBe(400);
    expect(await badLabel.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "label" } },
    });

    const badZone = await req(
      "/tables",
      { method: "POST", body: JSON.stringify({ label: unique("q"), zoneId: 123 }) },
      managerCookie,
    );
    expect(badZone.status).toBe(400);
    expect(await badZone.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "zoneId" } },
    });

    const badCap = await req(
      "/tables",
      { method: "POST", body: JSON.stringify({ label: unique("q"), capacity: 1.5 }) },
      managerCookie,
    );
    expect(badCap.status).toBe(400);
    expect(await badCap.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "capacity" } },
    });
  });

  it("PATCH edits label/capacity + assigns a zone (204), then GET reflects it", async () => {
    const { id } = (await (
      await req(
        "/tables",
        { method: "POST", body: JSON.stringify({ label: unique("t") }) },
        managerCookie,
      )
    ).json()) as { id: string };
    const zoneId = await createZone(unique("PatchZone"));

    const newLabel = unique("t-edited");
    const patch = await req(
      `/tables/${id}`,
      { method: "PATCH", body: JSON.stringify({ label: newLabel, capacity: 6, zoneId }) },
      managerCookie,
    );
    expect(patch.status).toBe(204);
    expect(await patch.text()).toBe("");

    const list = (await (await req("/tables", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      label: string;
      capacity: number | null;
      zoneId: string | null;
    }[];
    expect(list.find((t) => t.id === id)).toMatchObject({ label: newLabel, capacity: 6, zoneId });
  });

  it("PATCH an unknown id → 404 table.not_found; a malformed :id → 404 too", async () => {
    const unknown = await req(
      "/tables/00000000-0000-4000-8000-000000000000",
      { method: "PATCH", body: JSON.stringify({ label: unique("X") }) },
      managerCookie,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "table.not_found" } });

    const malformed = await req(
      "/tables/not-a-uuid",
      { method: "PATCH", body: JSON.stringify({ label: unique("X") }) },
      managerCookie,
    );
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({ error: { code: "table.not_found" } });
  });

  it("PATCH with a zoneId that names no zone → 404 zone.not_found", async () => {
    const { id } = (await (
      await req(
        "/tables",
        { method: "POST", body: JSON.stringify({ label: unique("t") }) },
        managerCookie,
      )
    ).json()) as { id: string };
    const res = await req(
      `/tables/${id}`,
      { method: "PATCH", body: JSON.stringify({ zoneId: "00000000-0000-4000-8000-000000000000" }) },
      managerCookie,
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "zone.not_found" } });
  });

  it("PATCH with a MALFORMED zoneId → 404 zone.not_found (the isUuid guard)", async () => {
    const { id } = (await (
      await req(
        "/tables",
        { method: "POST", body: JSON.stringify({ label: unique("t") }) },
        managerCookie,
      )
    ).json()) as { id: string };
    const res = await req(
      `/tables/${id}`,
      { method: "PATCH", body: JSON.stringify({ zoneId: "not-a-uuid" }) },
      managerCookie,
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "zone.not_found" } });
  });

  it("PATCH body screens: array → body; non-string label/zoneId; bad capacity; empty → 204 no-op", async () => {
    const id = randomUUID();

    const arrayBody = await req(`/tables/${id}`, { method: "PATCH", body: "[]" }, managerCookie);
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });

    const badLabel = await req(
      `/tables/${id}`,
      { method: "PATCH", body: JSON.stringify({ label: 123 }) },
      managerCookie,
    );
    expect(badLabel.status).toBe(400);
    expect(await badLabel.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "label" } },
    });

    const badZone = await req(
      `/tables/${id}`,
      { method: "PATCH", body: JSON.stringify({ zoneId: 123 }) },
      managerCookie,
    );
    expect(badZone.status).toBe(400);
    expect(await badZone.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "zoneId" } },
    });

    const badCap = await req(
      `/tables/${id}`,
      { method: "PATCH", body: JSON.stringify({ capacity: 1.5 }) },
      managerCookie,
    );
    expect(badCap.status).toBe(400);
    expect(await badCap.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "capacity" } },
    });

    const nullBody = await req(`/tables/${id}`, { method: "PATCH", body: "null" }, managerCookie);
    expect(nullBody.status).toBe(204);
    const emptyBody = await req(`/tables/${id}`, { method: "PATCH", body: "{}" }, managerCookie);
    expect(emptyBody.status).toBe(204);
  });

  it("DELETE deactivates a table (204), then GET drops it", async () => {
    const { id } = (await (
      await req(
        "/tables",
        { method: "POST", body: JSON.stringify({ label: unique("gone") }) },
        managerCookie,
      )
    ).json()) as { id: string };

    const del = await req(`/tables/${id}`, { method: "DELETE" }, managerCookie);
    expect(del.status).toBe(204);
    expect(await del.text()).toBe("");

    const list = (await (await req("/tables", { method: "GET" }, managerCookie)).json()) as {
      id: string;
    }[];
    expect(list.find((t) => t.id === id)).toBeUndefined();
  });

  describe("disabled tables: the includeDisabled list and PATCH active", () => {
    async function newTable(): Promise<string> {
      const res = await req(
        "/tables",
        { method: "POST", body: JSON.stringify({ label: unique("en") }) },
        managerCookie,
      );
      return ((await res.json()) as { id: string }).id;
    }
    async function listAll(): Promise<{ id: string; label: string; active: boolean }[]> {
      const res = await req("/tables?includeDisabled=true", { method: "GET" }, managerCookie);
      expect(res.status).toBe(200);
      return (await res.json()) as { id: string; label: string; active: boolean }[];
    }

    it("GET ?includeDisabled=true lists a disabled table with active: false; the plain GET still drops it", async () => {
      const id = await newTable();
      expect((await req(`/tables/${id}`, { method: "DELETE" }, managerCookie)).status).toBe(204);
      expect((await listAll()).find((t) => t.id === id)).toMatchObject({ active: false });
      const plain = (await (await req("/tables", { method: "GET" }, managerCookie)).json()) as {
        id: string;
      }[];
      expect(plain.find((t) => t.id === id)).toBeUndefined();
    });

    it("PATCH active: true enables a disabled table; PATCH active: false disables it again", async () => {
      const id = await newTable();
      await req(`/tables/${id}`, { method: "DELETE" }, managerCookie);

      const enable = await req(
        `/tables/${id}`,
        { method: "PATCH", body: JSON.stringify({ active: true }) },
        managerCookie,
      );
      expect(enable.status).toBe(204);
      expect((await listAll()).find((t) => t.id === id)).toMatchObject({ active: true });
      const plain = (await (await req("/tables", { method: "GET" }, managerCookie)).json()) as {
        id: string;
      }[];
      expect(plain.find((t) => t.id === id)).toBeDefined();

      const disable = await req(
        `/tables/${id}`,
        { method: "PATCH", body: JSON.stringify({ active: false }) },
        managerCookie,
      );
      expect(disable.status).toBe(204);
      expect((await listAll()).find((t) => t.id === id)).toMatchObject({ active: false });
    });

    it("PATCH active beside an edit applies both", async () => {
      const id = await newTable();
      await req(`/tables/${id}`, { method: "DELETE" }, managerCookie);
      const label = unique("both");
      const res = await req(
        `/tables/${id}`,
        { method: "PATCH", body: JSON.stringify({ label, active: true }) },
        managerCookie,
      );
      expect(res.status).toBe(204);
      expect((await listAll()).find((t) => t.id === id)).toMatchObject({ label, active: true });
    });

    it("PATCH refuses an explicit null or a non-boolean active (400, field active) and changes nothing", async () => {
      const id = await newTable();
      await req(`/tables/${id}`, { method: "DELETE" }, managerCookie);
      for (const active of [null, "true", 1]) {
        const res = await req(
          `/tables/${id}`,
          { method: "PATCH", body: JSON.stringify({ active }) },
          managerCookie,
        );
        expect(res.status, String(active)).toBe(400);
        expect(await res.json()).toMatchObject({
          error: { code: "management.request_invalid", params: { field: "active" } },
        });
      }
      expect((await listAll()).find((t) => t.id === id)).toMatchObject({ active: false });
    });

    it("PATCH active: true on an unknown id → 404 table.not_found", async () => {
      const res = await req(
        "/tables/00000000-0000-4000-8000-000000000000",
        { method: "PATCH", body: JSON.stringify({ active: true }) },
        managerCookie,
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "table.not_found" } });
    });

    async function tableInServiceZone(): Promise<{
      departmentId: string;
      zoneId: string;
      tableId: string;
    }> {
      const cfg = tillConfigFromVenue(venue);
      const zoneId = await createZone(unique("Served"));
      const departmentId = await withTransaction(suite.db, async (tx) => {
        const department = await createDepartment(tx, cfg, {
          name: unique("Dept"),
          orderStart: "table",
        });
        await configureZone(tx, cfg, { zoneId, departmentId: department.id });
        return department.id;
      });
      const res = await req(
        "/tables",
        { method: "POST", body: JSON.stringify({ label: unique("zt"), zoneId }) },
        managerCookie,
      );
      expect(res.status).toBe(201);
      return { departmentId, zoneId, tableId: ((await res.json()) as { id: string }).id };
    }
    async function enable(tableId: string, extra: Record<string, unknown> = {}) {
      return req(
        `/tables/${tableId}`,
        { method: "PATCH", body: JSON.stringify({ ...extra, active: true }) },
        managerCookie,
      );
    }

    it.each(["zone", "department"])(
      "refuses moving an active table into a disabled %s without an active patch",
      async (parent) => {
        const source = await tableInServiceZone();
        const destination = await tableInServiceZone();
        if (parent === "zone") {
          expect(
            (await req(`/zones/${destination.zoneId}`, { method: "DELETE" }, managerCookie)).status,
          ).toBe(204);
        } else {
          await withTransaction(suite.db, (tx) =>
            deactivateDepartment(tx, tillConfigFromVenue(venue), destination.departmentId),
          );
          await withTransaction(suite.db, (tx) =>
            tx
              .update(floorZones)
              .set({ active: true })
              .where(eq(floorZones.id, destination.zoneId)),
          );
        }
        const response = await req(
          `/tables/${source.tableId}`,
          { method: "PATCH", body: JSON.stringify({ zoneId: destination.zoneId }) },
          managerCookie,
        );
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          error: {
            code: "table.zone_inactive",
            params: { tableId: source.tableId, zoneId: destination.zoneId },
          },
        });
        expect((await listAll()).find((t) => t.id === source.tableId)).toMatchObject({
          active: true,
          zoneId: source.zoneId,
        });
      },
    );

    it("refuses enabling a zone whose department is disabled", async () => {
      const { departmentId, zoneId } = await tableInServiceZone();
      await withTransaction(suite.db, (tx) =>
        deactivateDepartment(tx, tillConfigFromVenue(venue), departmentId),
      );
      const response = await req(
        `/zones/${zoneId}`,
        { method: "PATCH", body: JSON.stringify({ active: true }) },
        managerCookie,
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: "zone.department_inactive", params: { zoneId } },
      });
      const list = (await (
        await req("/zones?includeInactive=true", { method: "GET" }, managerCookie)
      ).json()) as { id: string; active: boolean }[];
      expect(list.find((z) => z.id === zoneId)).toMatchObject({ active: false });
    });

    it("refuses enabling a zone without a department", async () => {
      const [zone] = await withTransaction(suite.db, (tx) =>
        tx
          .insert(floorZones)
          .values({
            locationId: venue.locationId,
            name: unique("Unassigned disabled"),
            active: false,
          })
          .returning({ id: floorZones.id }),
      );
      const response = await req(
        `/zones/${zone!.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ active: true }),
        },
        managerCookie,
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: "zone.department_inactive", params: { zoneId: zone!.id } },
      });
      const [stored] = await suite.db
        .select({ active: floorZones.active })
        .from(floorZones)
        .where(eq(floorZones.id, zone!.id));
      expect(stored).toEqual({ active: false });
    });

    it.each(["active", "disabled"])(
      "judges the department when moving an %s zone",
      async (state) => {
        const source = await tableInServiceZone();
        const destination = await tableInServiceZone();
        await withTransaction(suite.db, (tx) =>
          deactivateDepartment(tx, tillConfigFromVenue(venue), destination.departmentId),
        );
        if (state === "disabled")
          expect(
            (await req(`/zones/${source.zoneId}`, { method: "DELETE" }, managerCookie)).status,
          ).toBe(204);
        const response = await req(
          `/venue-service/zones/${source.zoneId}`,
          {
            method: "PUT",
            body: JSON.stringify({ departmentId: destination.departmentId }),
          },
          managerCookie,
        );
        expect(response.status).toBe(state === "active" ? 409 : 204);
        if (state === "active")
          expect(await response.json()).toMatchObject({
            error: { code: "zone.department_inactive", params: { zoneId: source.zoneId } },
          });
        const stored = await suite.db.execute<{ department_id: string; active: number }>(
          sql`select p.department_id, z.active from zone_service_policies p join floor_zones z on z.id = p.zone_id where z.id = ${source.zoneId}`,
        );
        expect(stored.rows).toEqual([
          {
            department_id: state === "active" ? source.departmentId : destination.departmentId,
            active: state === "active" ? 1 : 0,
          },
        ]);
        expect((await listAll()).find((table) => table.id === source.tableId)).toMatchObject({
          active: state === "active",
          zoneId: source.zoneId,
        });
      },
    );

    it("allows moving an active zone to an active department", async () => {
      const source = await tableInServiceZone();
      const destination = await tableInServiceZone();
      const response = await req(
        `/venue-service/zones/${source.zoneId}`,
        {
          method: "PUT",
          body: JSON.stringify({ departmentId: destination.departmentId }),
        },
        managerCookie,
      );
      expect(response.status).toBe(204);
      const stored = await suite.db.execute<{ department_id: string }>(
        sql`select department_id from zone_service_policies where zone_id = ${source.zoneId}`,
      );
      expect(stored.rows).toEqual([{ department_id: destination.departmentId }]);
      expect((await listAll()).find((table) => table.id === source.tableId)).toMatchObject({
        active: true,
        zoneId: source.zoneId,
      });
    });

    it("allows enabling a zone under an active department without enabling its tables", async () => {
      const { zoneId, tableId } = await tableInServiceZone();
      await req(`/zones/${zoneId}`, { method: "DELETE" }, managerCookie);
      const response = await req(
        `/zones/${zoneId}`,
        { method: "PATCH", body: JSON.stringify({ active: true }) },
        managerCookie,
      );
      expect(response.status).toBe(204);
      const list = (await (await req("/zones", { method: "GET" }, managerCookie)).json()) as {
        id: string;
        active: boolean;
      }[];
      expect(list.find((z) => z.id === zoneId)).toMatchObject({ active: true });
      expect((await listAll()).find((t) => t.id === tableId)).toMatchObject({ active: false });
    });

    it.each(["zone", "department"])(
      "refuses creating an active table in a disabled %s",
      async (parent) => {
        const destination = await tableInServiceZone();
        if (parent === "zone")
          await req(`/zones/${destination.zoneId}`, { method: "DELETE" }, managerCookie);
        else {
          await withTransaction(suite.db, (tx) =>
            deactivateDepartment(tx, tillConfigFromVenue(venue), destination.departmentId),
          );
          await withTransaction(suite.db, (tx) =>
            tx
              .update(floorZones)
              .set({ active: true })
              .where(eq(floorZones.id, destination.zoneId)),
          );
        }
        const label = unique("Rejected new table");
        const response = await req(
          "/tables",
          { method: "POST", body: JSON.stringify({ label, zoneId: destination.zoneId }) },
          managerCookie,
        );
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          error: { code: "table.zone_inactive", params: { zoneId: destination.zoneId } },
        });
        expect((await listAll()).some((t) => t.label === label)).toBe(false);
      },
    );

    it("refuses placing an active table in a zone whose department is disabled", async () => {
      const source = await tableInServiceZone();
      const destination = await tableInServiceZone();
      await withTransaction(suite.db, (tx) =>
        deactivateDepartment(tx, tillConfigFromVenue(venue), destination.departmentId),
      );
      await withTransaction(suite.db, (tx) =>
        tx.update(floorZones).set({ active: true }).where(eq(floorZones.id, destination.zoneId)),
      );
      const response = await req(
        `/tables/${source.tableId}/placement`,
        {
          method: "PUT",
          body: JSON.stringify({
            zoneId: destination.zoneId,
            posX: 10,
            posY: 20,
            shape: "round",
            rotation: 0,
          }),
        },
        managerCookie,
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: {
          code: "table.zone_inactive",
          params: { tableId: source.tableId, zoneId: destination.zoneId },
        },
      });
      expect((await listAll()).find((t) => t.id === source.tableId)).toMatchObject({
        active: true,
        zoneId: source.zoneId,
        posX: null,
      });
    });

    it.each(["create", "move", "place"])(
      "refuses an active table's %s into a zone without a department",
      async (action) => {
        const source = await tableInServiceZone();
        const [zone] = await withTransaction(suite.db, (tx) =>
          tx
            .insert(floorZones)
            .values({ locationId: venue.locationId, name: unique("Unassigned") })
            .returning({ id: floorZones.id }),
        );
        const zoneId = zone!.id;
        const label = unique("Unassigned table");
        const response =
          action === "create"
            ? await req(
                "/tables",
                { method: "POST", body: JSON.stringify({ label, zoneId }) },
                managerCookie,
              )
            : action === "move"
              ? await req(
                  `/tables/${source.tableId}`,
                  { method: "PATCH", body: JSON.stringify({ zoneId }) },
                  managerCookie,
                )
              : await req(
                  `/tables/${source.tableId}/placement`,
                  {
                    method: "PUT",
                    body: JSON.stringify({
                      zoneId,
                      posX: 10,
                      posY: 20,
                      shape: "round",
                      rotation: 0,
                    }),
                  },
                  managerCookie,
                );
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          error: { code: "table.zone_inactive", params: { zoneId } },
        });
        expect((await listAll()).find((t) => t.id === source.tableId)).toMatchObject({
          active: true,
          zoneId: source.zoneId,
          posX: null,
        });
        expect((await listAll()).some((t) => t.label === label)).toBe(false);
      },
    );

    it("allows moving a disabled table into a disabled zone", async () => {
      const source = await tableInServiceZone();
      const destination = await tableInServiceZone();
      await req(`/tables/${source.tableId}`, { method: "DELETE" }, managerCookie);
      await req(`/zones/${destination.zoneId}`, { method: "DELETE" }, managerCookie);
      const response = await req(
        `/tables/${source.tableId}`,
        { method: "PATCH", body: JSON.stringify({ zoneId: destination.zoneId }) },
        managerCookie,
      );
      expect(response.status).toBe(204);
      expect((await listAll()).find((t) => t.id === source.tableId)).toMatchObject({
        active: false,
        zoneId: destination.zoneId,
      });
    });

    it("allows moving an active table between active service zones", async () => {
      const source = await tableInServiceZone();
      const destination = await tableInServiceZone();
      const response = await req(
        `/tables/${source.tableId}`,
        { method: "PATCH", body: JSON.stringify({ zoneId: destination.zoneId }) },
        managerCookie,
      );
      expect(response.status).toBe(204);
      expect((await listAll()).find((t) => t.id === source.tableId)).toMatchObject({
        active: true,
        zoneId: destination.zoneId,
      });
    });

    it("PATCH active: true enables a disabled table whose zone and department are active", async () => {
      const { tableId } = await tableInServiceZone();
      expect((await req(`/tables/${tableId}`, { method: "DELETE" }, managerCookie)).status).toBe(
        204,
      );
      expect((await enable(tableId)).status).toBe(204);
      expect((await listAll()).find((t) => t.id === tableId)).toMatchObject({ active: true });
    });

    it("PATCH active: true under a disabled zone → 409 table.zone_inactive, and the table stays disabled", async () => {
      const { zoneId, tableId } = await tableInServiceZone();
      expect((await req(`/zones/${zoneId}`, { method: "DELETE" }, managerCookie)).status).toBe(204);
      expect((await listAll()).find((t) => t.id === tableId)).toMatchObject({ active: false });

      const res = await enable(tableId);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        error: { code: "table.zone_inactive", params: { tableId, zoneId } },
      });
      expect((await listAll()).find((t) => t.id === tableId)).toMatchObject({ active: false });
    });

    it("PATCH active: true under a disabled department → 409 table.zone_inactive, even once the zone itself is enabled", async () => {
      const { departmentId, zoneId, tableId } = await tableInServiceZone();
      await withTransaction(suite.db, (tx) =>
        deactivateDepartment(tx, tillConfigFromVenue(venue), departmentId),
      );
      expect((await listAll()).find((t) => t.id === tableId)).toMatchObject({ active: false });

      const underDisabledZone = await enable(tableId);
      expect(underDisabledZone.status).toBe(409);
      expect(await underDisabledZone.json()).toMatchObject({
        error: { code: "table.zone_inactive", params: { tableId, zoneId } },
      });

      await withTransaction(suite.db, (tx) =>
        tx.update(floorZones).set({ active: true }).where(eq(floorZones.id, zoneId)),
      );
      const underDisabledDepartment = await enable(tableId);
      expect(underDisabledDepartment.status).toBe(409);
      expect(await underDisabledDepartment.json()).toMatchObject({
        error: { code: "table.zone_inactive", params: { tableId, zoneId } },
      });
      expect((await listAll()).find((t) => t.id === tableId)).toMatchObject({ active: false });
    });

    it("PATCH active: true with a zoneId judges the zone the table moves to", async () => {
      const { zoneId, tableId } = await tableInServiceZone();
      await req(`/zones/${zoneId}`, { method: "DELETE" }, managerCookie);
      const { zoneId: liveZoneId, tableId: other } = await tableInServiceZone();

      const res = await enable(tableId, { zoneId: liveZoneId });
      expect(res.status).toBe(204);
      expect((await listAll()).find((t) => t.id === tableId)).toMatchObject({
        active: true,
        zoneId: liveZoneId,
      });

      await req(`/tables/${other}`, { method: "DELETE" }, managerCookie);
      const intoDisabled = await enable(other, { zoneId });
      expect(intoDisabled.status).toBe(409);
      expect(await intoDisabled.json()).toMatchObject({
        error: { code: "table.zone_inactive", params: { tableId: other, zoneId } },
      });
      expect((await listAll()).find((t) => t.id === other)).toMatchObject({
        active: false,
        zoneId: liveZoneId,
      });
    });

    it("PATCH active: false and an edit without active still apply under a disabled zone", async () => {
      const { zoneId, tableId } = await tableInServiceZone();
      await req(`/zones/${zoneId}`, { method: "DELETE" }, managerCookie);
      const label = unique("renamed");
      expect(
        (
          await req(
            `/tables/${tableId}`,
            { method: "PATCH", body: JSON.stringify({ label }) },
            managerCookie,
          )
        ).status,
      ).toBe(204);
      expect(
        (
          await req(
            `/tables/${tableId}`,
            { method: "PATCH", body: JSON.stringify({ active: false }) },
            managerCookie,
          )
        ).status,
      ).toBe(204);
      expect((await listAll()).find((t) => t.id === tableId)).toMatchObject({
        label,
        active: false,
      });
    });

    it("a STAFF session is refused the includeDisabled list and PATCH active (403)", async () => {
      const id = await newTable();
      for (const res of [
        await req("/tables?includeDisabled=true", { method: "GET" }, staffCookie),
        await req(
          `/tables/${id}`,
          { method: "PATCH", body: JSON.stringify({ active: false }) },
          staffCookie,
        ),
      ]) {
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
      }
      expect((await listAll()).find((t) => t.id === id)).toMatchObject({ active: true });
    });
  });

  it("DELETE an unknown id → 404 table.not_found; a malformed :id → 404 too", async () => {
    const unknown = await req(
      "/tables/00000000-0000-4000-8000-000000000000",
      { method: "DELETE" },
      managerCookie,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "table.not_found" } });

    const malformed = await req("/tables/not-a-uuid", { method: "DELETE" }, managerCookie);
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({ error: { code: "table.not_found" } });
  });

  it("a STAFF session is refused on every table route (403 authorization.not_permitted)", async () => {
    const someId = randomUUID();
    const cases = [
      req("/tables", { method: "GET" }, staffCookie),
      req(
        "/tables",
        { method: "POST", body: JSON.stringify({ label: unique("Nope") }) },
        staffCookie,
      ),
      req(
        `/tables/${someId}`,
        { method: "PATCH", body: JSON.stringify({ label: unique("Z") }) },
        staffCookie,
      ),
      req(`/tables/${someId}`, { method: "DELETE" }, staffCookie),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    }
  });

  it("no session → 401 management_session.required on every table route", async () => {
    const someId = randomUUID();
    const cases = [
      req("/tables", { method: "GET" }, undefined),
      req("/tables", { method: "POST", body: JSON.stringify({ label: "Nope" }) }, undefined),
      req(
        `/tables/${someId}`,
        { method: "PATCH", body: JSON.stringify({ label: "Z" }) },
        undefined,
      ),
      req(`/tables/${someId}`, { method: "DELETE" }, undefined),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "management_session.required" } });
    }
  });
});

function place(zoneId: string): {
  zoneId: string;
  posX: number;
  posY: number;
  shape: string;
  rotation: number;
} {
  return { zoneId, posX: 500, posY: 250, shape: "square", rotation: 0 };
}

async function readPlacement(tableId: string): Promise<{
  posX: number | null;
  posY: number | null;
  shape: string | null;
  rotation: number | null;
}> {
  return withTransaction(suite.db, async (tx) => {
    const { rows } = await tx.execute<{
      pos_x: number | null;
      pos_y: number | null;
      shape: string | null;
      rotation: number | null;
    }>(sql`select pos_x, pos_y, shape, rotation from dining_tables where id = ${tableId}`);
    const r = rows[0]!;
    return { posX: r.pos_x, posY: r.pos_y, shape: r.shape, rotation: r.rotation };
  });
}

describe("/management-api/tables/:id/placement", () => {
  /** `setTablePlacement` requires both the table and the zone live. */
  async function tableAndZone(): Promise<{ tableId: string; zoneId: string }> {
    const zoneId = await createZone(unique("PlaceZone"));
    const { id: tableId } = (await (
      await req(
        "/tables",
        { method: "POST", body: JSON.stringify({ label: unique("p") }) },
        managerCookie,
      )
    ).json()) as { id: string };
    return { tableId, zoneId };
  }

  it("manager places a table (204) + read-back shows it; staff is 403; no session is 401", async () => {
    const { tableId, zoneId } = await tableAndZone();

    const unauth = await req(`/tables/${tableId}/placement`, {
      method: "PUT",
      body: JSON.stringify(place(zoneId)),
    });
    expect(unauth.status).toBe(401);
    expect(await unauth.json()).toMatchObject({ error: { code: "management_session.required" } });

    // A staff person can log in but holds no `venue.configure`.
    const staff = await req(
      `/tables/${tableId}/placement`,
      { method: "PUT", body: JSON.stringify(place(zoneId)) },
      staffCookie,
    );
    expect(staff.status).toBe(403);
    expect(await staff.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    expect(await readPlacement(tableId)).toMatchObject({ posX: null, posY: null, shape: null });

    const ok = await req(
      `/tables/${tableId}/placement`,
      { method: "PUT", body: JSON.stringify(place(zoneId)) },
      managerCookie,
    );
    expect(ok.status).toBe(204);
    expect(await ok.text()).toBe("");
    expect(await readPlacement(tableId)).toMatchObject({
      posX: 500,
      posY: 250,
      shape: "square",
      rotation: 0,
    });
  });

  it("manager clears a placement (204) + read-back nulls it; staff is 403; no session is 401", async () => {
    const { tableId, zoneId } = await tableAndZone();
    await req(
      `/tables/${tableId}/placement`,
      { method: "PUT", body: JSON.stringify(place(zoneId)) },
      managerCookie,
    );

    const unauth = await req(`/tables/${tableId}/placement`, { method: "DELETE" });
    expect(unauth.status).toBe(401);
    expect(await unauth.json()).toMatchObject({ error: { code: "management_session.required" } });

    const staff = await req(`/tables/${tableId}/placement`, { method: "DELETE" }, staffCookie);
    expect(staff.status).toBe(403);
    expect(await staff.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    expect(await readPlacement(tableId)).toMatchObject({ posX: 500, posY: 250, shape: "square" });

    const ok = await req(`/tables/${tableId}/placement`, { method: "DELETE" }, managerCookie);
    expect(ok.status).toBe(204);
    expect(await ok.text()).toBe("");
    expect(await readPlacement(tableId)).toMatchObject({
      posX: null,
      posY: null,
      shape: null,
      rotation: null,
    });
  });

  it("PUT a malformed :id → 404 table.not_found; an unknown id → 404 too", async () => {
    const zoneId = await createZone(unique("PZ"));

    const malformed = await req(
      "/tables/not-a-uuid/placement",
      { method: "PUT", body: JSON.stringify(place(zoneId)) },
      managerCookie,
    );
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({ error: { code: "table.not_found" } });

    const unknown = await req(
      "/tables/00000000-0000-4000-8000-000000000000/placement",
      { method: "PUT", body: JSON.stringify(place(zoneId)) },
      managerCookie,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "table.not_found" } });
  });

  it("DELETE a malformed :id → 404 table.not_found; an unknown id → 404 too", async () => {
    const malformed = await req(
      "/tables/not-a-uuid/placement",
      { method: "DELETE" },
      managerCookie,
    );
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({ error: { code: "table.not_found" } });

    const unknown = await req(
      "/tables/00000000-0000-4000-8000-000000000000/placement",
      { method: "DELETE" },
      managerCookie,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "table.not_found" } });
  });

  it("PUT with a zoneId naming no LIVE zone → 404 zone.not_found; a malformed zoneId → 404 too", async () => {
    const { tableId } = await tableAndZone();

    const missing = await req(
      `/tables/${tableId}/placement`,
      { method: "PUT", body: JSON.stringify(place("00000000-0000-4000-8000-000000000000")) },
      managerCookie,
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "zone.not_found" } });

    const malformed = await req(
      `/tables/${tableId}/placement`,
      { method: "PUT", body: JSON.stringify({ ...place("x"), zoneId: "not-a-uuid" }) },
      managerCookie,
    );
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({ error: { code: "zone.not_found" } });
  });

  it("PUT body screens: array → body; non-string zoneId; non-number posX/posY/rotation; non-string shape", async () => {
    const id = randomUUID();
    const base = { zoneId: randomUUID(), posX: 500, posY: 250, shape: "square", rotation: 0 };

    // A `null` body is read as `{}`, so the first field screen fires, not the "body" one.
    const nullBody = await req(
      `/tables/${id}/placement`,
      { method: "PUT", body: "null" },
      managerCookie,
    );
    expect(nullBody.status).toBe(400);
    expect(await nullBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "zoneId" } },
    });

    const arrayBody = await req(
      `/tables/${id}/placement`,
      { method: "PUT", body: "[]" },
      managerCookie,
    );
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });

    const cases: readonly [string, Record<string, unknown>][] = [
      ["zoneId", { ...base, zoneId: 123 }],
      ["posX", { ...base, posX: "500" }],
      ["posY", { ...base, posY: "250" }],
      ["shape", { ...base, shape: 1 }],
      ["rotation", { ...base, rotation: "0" }],
    ];
    for (const [field, body] of cases) {
      const res = await req(
        `/tables/${id}/placement`,
        { method: "PUT", body: JSON.stringify(body) },
        managerCookie,
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
  });

  it("PUT with an out-of-range coordinate → 400 placement.invalid (the verb's field guard, mapped here)", async () => {
    const { tableId, zoneId } = await tableAndZone();
    const res = await req(
      `/tables/${tableId}/placement`,
      { method: "PUT", body: JSON.stringify({ ...place(zoneId), posX: 1001 }) },
      managerCookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "placement.invalid", params: { field: "posX" } },
    });
  });
});

describe("/management-api/stations (KDS-1 config)", () => {
  async function createStation(
    name: string,
    extra: { isDefault?: boolean; displayOrder?: number } = {},
  ): Promise<string> {
    const res = await req(
      "/stations",
      { method: "POST", body: JSON.stringify({ name, ...extra }) },
      managerCookie,
    );
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  async function listStations(): Promise<
    {
      id: string;
      name: string;
      displayOrder: number;
      isDefault: boolean;
      active: boolean;
      showsRestOfOrder: boolean;
    }[]
  > {
    return (await (await req("/stations", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      name: string;
      displayOrder: number;
      isDefault: boolean;
      active: boolean;
      showsRestOfOrder: boolean;
    }[];
  }

  it("explicitly lists retained disabled station metadata without changing the default active-only list", async () => {
    const id = await createStation(unique("Retained metadata"));
    await req(`/stations/${id}`, { method: "DELETE" }, managerCookie);
    expect((await listStations()).some((station) => station.id === id)).toBe(false);
    const response = await req("/stations?includeDisabled=true", { method: "GET" }, managerCookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toContainEqual(expect.objectContaining({ id, active: false }));
  });
  it("saves the complete active station order atomically without changing default or disabled rows", async () => {
    await createStation(unique("First order"), { displayOrder: 8 });
    await createStation(unique("Second order"), { displayOrder: 9 });
    const disabled = await createStation(unique("Retained order"), { displayOrder: 17 });
    await req(`/stations/${disabled}`, { method: "DELETE" }, managerCookie);
    const disabledBefore = await suite.db
      .select()
      .from(kitchenStations)
      .where(eq(kitchenStations.id, disabled));
    const before = await listStations();
    const active = before.filter((station) => station.active);
    const ids = active.map((station) => station.id).reverse();
    const response = await req(
      "/stations/order",
      { method: "PUT", body: JSON.stringify({ ids }) },
      managerCookie,
    );
    expect(response.status).toBe(204);
    const after = await listStations();
    expect(after.filter((station) => station.active).map((station) => station.id)).toEqual(ids);
    expect(
      after.filter((station) => station.active).map((station) => station.displayOrder),
    ).toEqual(ids.map((_, index) => index));
    expect(
      await suite.db.select().from(kitchenStations).where(eq(kitchenStations.id, disabled)),
    ).toEqual(disabledBefore);
    expect(after.filter((station) => station.isDefault).map((station) => station.id)).toEqual(
      before.filter((station) => station.isDefault).map((station) => station.id),
    );
  });
  it("refuses malformed, incomplete, duplicate, missing and disabled station order sets before any write", async () => {
    const disabled = await createStation(unique("Disabled order"));
    await req(`/stations/${disabled}`, { method: "DELETE" }, managerCookie);
    const before = await listStations();
    const ids = before.filter((station) => station.active).map((station) => station.id);
    for (const body of [
      null,
      [],
      {},
      { ids: null },
      { ids: "wrong" },
      { ids: [] },
      { ids: ids.slice(1) },
      { ids: [...ids, ids[0]] },
      { ids: [...ids, disabled] },
      { ids: [...ids, randomUUID()] },
    ]) {
      const response = await req(
        "/stations/order",
        { method: "PUT", body: JSON.stringify(body) },
        managerCookie,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "ids" } },
      });
      expect(await listStations()).toEqual(before);
    }
  });
  it("station ordering requires configuration permission and a session", async () => {
    const ids = (await listStations())
      .filter((station) => station.active)
      .map((station) => station.id);
    const before = await listStations();
    for (const [cookie, status] of [
      [undefined, 401],
      [staffCookie, 403],
      [supervisorCookie, 403],
    ] as const) {
      const response = await req(
        "/stations/order",
        { method: "PUT", body: JSON.stringify({ ids }) },
        cookie,
      );
      expect(response.status).toBe(status);
    }
    expect(await listStations()).toEqual(before);
  });
  it("POST creates (201 { id }) + GET lists it, active, at its display order (manager)", async () => {
    const name = unique("Cocina");
    const id = await createStation(name, { displayOrder: 2 });
    const found = (await listStations()).find((s) => s.id === id);
    expect(found).toMatchObject({ name, displayOrder: 2, isDefault: false, active: true });
  });

  it("lists a new station with the rest of the order switch off", async () => {
    const id = await createStation(unique("Rest default"));
    expect((await listStations()).find((station) => station.id === id)).toMatchObject({
      showsRestOfOrder: false,
    });
  });

  it("POST stores timing overrides atomically and rejects an unordered effective set without a row", async () => {
    const name = unique("Atomic");
    const created = await req(
      "/stations",
      {
        method: "POST",
        body: JSON.stringify({
          name,
          displayOrder: 2,
          warmAfterMinutes: 3,
          overdueAfterMinutes: 8,
          forgottenAfterMinutes: 12,
        }),
      },
      managerCookie,
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const row = await suite.db.execute<{
      warm_after_minutes: number;
      overdue_after_minutes: number;
      forgotten_after_minutes: number;
    }>(
      sql`select warm_after_minutes, overdue_after_minutes, forgotten_after_minutes
        from kitchen_station_timing where station_id = ${id}`,
    );
    expect(row.rows[0]).toMatchObject({
      warm_after_minutes: 3,
      overdue_after_minutes: 8,
      forgotten_after_minutes: 12,
    });
    for (const thresholds of [
      { warmAfterMinutes: 10 },
      { warmAfterMinutes: 9, overdueAfterMinutes: 8, forgottenAfterMinutes: 12 },
    ]) {
      const rejectedName = unique("Rejected");
      const rejected = await req(
        "/stations",
        { method: "POST", body: JSON.stringify({ name: rejectedName, ...thresholds }) },
        managerCookie,
      );
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toMatchObject({
        error: {
          code: "station.thresholds_invalid",
          params: { field: "overdueAfterMinutes", name: rejectedName },
        },
      });
      expect((await listStations()).some((station) => station.name === rejectedName)).toBe(false);
    }
  });

  it("POST accepts partial and null overrides and GET resolves the inherited fields", async () => {
    for (const thresholds of [
      { warmAfterMinutes: 2 },
      { warmAfterMinutes: null, overdueAfterMinutes: 8 },
    ]) {
      const created = await req(
        "/stations",
        { method: "POST", body: JSON.stringify({ name: unique("Inherit"), ...thresholds }) },
        managerCookie,
      );
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      const stations = (await (
        await req("/stations", { method: "GET" }, managerCookie)
      ).json()) as Record<string, unknown>[];
      expect(stations.find((station) => station.id === id)).toMatchObject({
        warmAfterMinutes: thresholds.warmAfterMinutes === null ? 5 : 2,
        overdueAfterMinutes: "overdueAfterMinutes" in thresholds ? 8 : 10,
        forgottenAfterMinutes: 15,
      });
    }
  });

  it("PATCH null inherits one field while omission retains overrides and defaults stay unchanged", async () => {
    const id = await createStation(unique("Clear override"));
    const patch = (body: unknown) =>
      req(`/stations/${id}`, { method: "PATCH", body: JSON.stringify(body) }, managerCookie);
    const read = async () =>
      (
        await suite.db
          .select()
          .from(kitchenStationTiming)
          .where(eq(kitchenStationTiming.stationId, id))
      )[0];
    const beforeDefaults = await (
      await req("/kitchen-timing-defaults", { method: "GET" }, managerCookie)
    ).json();
    expect(
      (await patch({ warmAfterMinutes: 2, overdueAfterMinutes: 8, forgottenAfterMinutes: 12 }))
        .status,
    ).toBe(204);
    expect((await patch({ warmAfterMinutes: null })).status).toBe(204);
    expect(await read()).toEqual({
      stationId: id,
      warmAfterMinutes: null,
      overdueAfterMinutes: 8,
      forgottenAfterMinutes: 12,
    });
    const stations = (await (
      await req("/stations", { method: "GET" }, managerCookie)
    ).json()) as Record<string, unknown>[];
    expect(stations.find((station) => station.id === id)).toMatchObject({
      warmAfterMinutes: 5,
      overdueAfterMinutes: 8,
      forgottenAfterMinutes: 12,
    });
    expect((await patch({ overdueAfterMinutes: null, forgottenAfterMinutes: null })).status).toBe(
      204,
    );
    expect(await read()).toEqual({
      stationId: id,
      warmAfterMinutes: null,
      overdueAfterMinutes: null,
      forgottenAfterMinutes: null,
    });
    expect(
      await (await req("/kitchen-timing-defaults", { method: "GET" }, managerCookie)).json(),
    ).toEqual(beforeDefaults);
  });

  it.each(["warmAfterMinutes", "overdueAfterMinutes", "forgottenAfterMinutes"])(
    "PATCH refuses invalid %s types and ranges without changing any station fields",
    async (field) => {
      const name = unique("Bad override");
      const id = await createStation(name);
      for (const value of ["3", [3], {}, true, 0, -1, 1.5, 2147483648]) {
        const response = await req(
          `/stations/${id}`,
          { method: "PATCH", body: JSON.stringify({ name: "Should not save", [field]: value }) },
          managerCookie,
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          error: { code: "management.request_invalid", params: { field } },
        });
        expect((await listStations()).find((station) => station.id === id)).toMatchObject({ name });
        expect(
          await suite.db
            .select()
            .from(kitchenStationTiming)
            .where(eq(kitchenStationTiming.stationId, id)),
        ).toEqual([]);
      }
    },
  );

  it("PATCH refuses inherited order inversions before saving name or overrides, and unknown ids affect no station", async () => {
    const name = unique("Effective order");
    const id = await createStation(name);
    expect(
      (
        await req(
          `/stations/${id}`,
          {
            method: "PATCH",
            body: JSON.stringify({ warmAfterMinutes: 2, overdueAfterMinutes: 4 }),
          },
          managerCookie,
        )
      ).status,
    ).toBe(204);
    const before = await suite.db
      .select()
      .from(kitchenStationTiming)
      .where(eq(kitchenStationTiming.stationId, id));
    const refused = await req(
      `/stations/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ name: "Should not save", warmAfterMinutes: null }),
      },
      managerCookie,
    );
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: {
        code: "station.thresholds_invalid",
        params: { field: "overdueAfterMinutes", stationId: id, name },
      },
    });
    const missing = randomUUID();
    const unknown = await req(
      `/stations/${missing}`,
      { method: "PATCH", body: JSON.stringify({ overdueAfterMinutes: 7 }) },
      managerCookie,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({
      error: { code: "station.not_found", params: { stationId: missing } },
    });
    expect(
      await suite.db
        .select()
        .from(kitchenStationTiming)
        .where(eq(kitchenStationTiming.stationId, missing)),
    ).toEqual([]);
    expect(
      await suite.db
        .select()
        .from(kitchenStationTiming)
        .where(eq(kitchenStationTiming.stationId, id)),
    ).toEqual(before);
    expect((await listStations()).find((station) => station.id === id)).toMatchObject({ name });
  });

  it("POST with a duplicate name → 409 station.name_taken", async () => {
    const name = unique("dup");
    await createStation(name);
    const dup = await req(
      "/stations",
      { method: "POST", body: JSON.stringify({ name }) },
      managerCookie,
    );
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: { code: "station.name_taken" } });
  });

  it("POST body-shape faults → 400 management.request_invalid (non-object, missing name, bad isDefault)", async () => {
    const nullBody = await req("/stations", { method: "POST", body: "null" }, managerCookie);
    expect(nullBody.status).toBe(400);
    expect(await nullBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "name" } },
    });
    const arrayBody = await req("/stations", { method: "POST", body: "[]" }, managerCookie);
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });
    const badDefault = await req(
      "/stations",
      { method: "POST", body: JSON.stringify({ name: unique("X"), isDefault: "yes" }) },
      managerCookie,
    );
    expect(badDefault.status).toBe(400);
    expect(await badDefault.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "isDefault" } },
    });
  });

  it("POST { isDefault:true } adopts the default; POST /:id/default flips it atomically to another", async () => {
    const first = await createStation(unique("Def1"), { isDefault: true });
    // A second default clears the prior one.
    const second = await createStation(unique("Def2"), { isDefault: true });
    let list = await listStations();
    expect(list.find((s) => s.id === first)!.isDefault).toBe(false);
    expect(list.find((s) => s.id === second)!.isDefault).toBe(true);

    // set-default route flips it back to `first`.
    const setDefault = await req(`/stations/${first}/default`, { method: "POST" }, managerCookie);
    expect(setDefault.status).toBe(204);
    list = await listStations();
    expect(list.find((s) => s.id === first)!.isDefault).toBe(true);
    expect(list.find((s) => s.id === second)!.isDefault).toBe(false);
  });

  it("ignores a saved Closed week while its station is the default, refuses a stale editor's save, and resumes the week on demotion", async () => {
    const cfg = { locationId: brandLocationId(venue.locationId) };
    const first = await createStation(unique("Swap default"), { isDefault: true });
    const second = await createStation(unique("Swap closed"));
    const subject = { kind: "station" as const, id: second };
    // Tuesday 6 October 2026, 12:00 in Madrid.
    const at = new Date("2026-10-06T10:00:00Z");
    const weekOf = (mode: "closed" | "all_day") =>
      WEEK_DISPLAY_ORDER.map((weekday) => ({ weekday, cell: { mode, periods: [] as [] } }));
    await withTransaction(suite.db, (tx) =>
      replaceWeekHours(tx, cfg, subject, weekOf("closed"), at),
    );
    const state = async () =>
      (await withTransaction(suite.db, (tx) => stationStates(tx, cfg, at))).get(second);
    const storedWeek = () => withTransaction(suite.db, (tx) => readWeekHours(tx, cfg, subject));
    expect(await state()).toMatchObject({ open: false, isDefault: false, active: true });

    expect(
      (await req(`/stations/${second}/default`, { method: "POST" }, managerCookie)).status,
    ).toBe(204);
    expect(await state()).toMatchObject({ open: true, isDefault: true, active: true });
    const kept = await storedWeek();
    expect(kept.map((day) => day.cell.mode)).toEqual(Array(7).fill("closed"));
    // An editor opened before the switch still holds the week; its save is refused and writes nothing.
    await expect(
      withTransaction(suite.db, (tx) => replaceWeekHours(tx, cfg, subject, weekOf("all_day"), at)),
    ).rejects.toMatchObject({ code: "station.always_open", params: { stationId: second } });
    expect(await storedWeek()).toEqual(kept);

    expect(
      (await req(`/stations/${first}/default`, { method: "POST" }, managerCookie)).status,
    ).toBe(204);
    expect(await state()).toMatchObject({ open: false, isDefault: false, active: true });
    expect((await req(`/stations/${second}`, { method: "DELETE" }, managerCookie)).status).toBe(
      204,
    );
    expect(await state()).toMatchObject({ open: false, isDefault: false, active: false });
  });

  it("refuses a new default with 400 hours.invalid, changing nothing, while the default it replaces would resume clashing hours", async () => {
    const cfg = { locationId: brandLocationId(venue.locationId) };
    const kitchen = await createStation(unique("Resume kitchen"), { isDefault: true });
    const barName = unique("Resume bar");
    const bar = await createStation(barName);
    const subject = { kind: "station" as const, id: bar };
    const at = new Date("2026-10-06T10:00:00Z");
    // Dates far enough ahead to stay current whenever the suite runs.
    const barDate = (date: string, opensAt: string, closesAt: string) => ({
      date,
      name: unique("Resume date"),
      colour: "red" as const,
      closeWholeVenue: false,
      cells: [
        {
          subject,
          cell: { mode: "periods" as const, periods: [{ id: randomUUID(), opensAt, closesAt }] },
        },
      ],
    });
    await withTransaction(suite.db, async (tx) => {
      await replaceWeekHours(
        tx,
        cfg,
        subject,
        WEEK_DISPLAY_ORDER.map((weekday) => ({ weekday, cell: { mode: "closed", periods: [] } })),
        at,
      );
      await saveSpecialDate(tx, cfg, null, barDate("2096-06-09", "22:00", "03:00"), at);
    });
    const later = await withTransaction(suite.db, (tx) =>
      saveSpecialDate(tx, cfg, null, barDate("2096-06-12", "01:00", "05:00"), at),
    );
    expect((await req(`/stations/${bar}/default`, { method: "POST" }, managerCookie)).status).toBe(
      204,
    );
    await withTransaction(suite.db, (tx) =>
      saveSpecialDate(
        tx,
        cfg,
        later.id,
        { ...barDate("2096-06-10", "01:00", "05:00"), name: later.name, cells: [] },
        at,
      ),
    );

    const refusal = {
      error: {
        code: "hours.invalid",
        params: { field: "date", date: "2096-06-10", subjectId: bar },
      },
    };
    const swap = await req(`/stations/${kitchen}/default`, { method: "POST" }, managerCookie);
    expect(swap.status).toBe(400);
    expect(await swap.json()).toEqual(refusal);
    const newName = unique("Resume new default");
    const created = await req(
      "/stations",
      { method: "POST", body: JSON.stringify({ name: newName, isDefault: true }) },
      managerCookie,
    );
    expect(created.status).toBe(400);
    expect(await created.json()).toEqual(refusal);
    let list = await listStations();
    expect(list.find((s) => s.id === bar)!.isDefault).toBe(true);
    expect(list.find((s) => s.id === kitchen)!.isDefault).toBe(false);
    expect(list.some((s) => s.name === newName)).toBe(false);

    await withTransaction(suite.db, (tx) => deleteSpecialDate(tx, cfg, later.id, at));
    expect(
      (await req(`/stations/${kitchen}/default`, { method: "POST" }, managerCookie)).status,
    ).toBe(204);
    list = await listStations();
    expect(list.find((s) => s.id === kitchen)!.isDefault).toBe(true);
    expect(list.find((s) => s.name === barName)!.isDefault).toBe(false);
  });

  it("POST /:id/default on an unknown or malformed id → 404 station.not_found", async () => {
    const unknown = await req(
      `/stations/${randomUUID()}/default`,
      { method: "POST" },
      managerCookie,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "station.not_found" } });
    const malformed = await req("/stations/not-a-uuid/default", { method: "POST" }, managerCookie);
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({ error: { code: "station.not_found" } });
  });

  it("PATCH edits name/displayOrder/active; a rename collision → 409; empty patch → 204 no-op; unknown/malformed :id → 404", async () => {
    const id = await createStation(unique("Edit"));
    const patch = await req(
      `/stations/${id}`,
      { method: "PATCH", body: JSON.stringify({ displayOrder: 7, active: false }) },
      managerCookie,
    );
    expect(patch.status).toBe(204);
    // Through the table definition: a raw `select active` returns the stored integer, not a boolean.
    const [row] = await suite.db
      .select({ displayOrder: kitchenStations.displayOrder, active: kitchenStations.active })
      .from(kitchenStations)
      .where(eq(kitchenStations.id, id));
    expect(row).toMatchObject({ displayOrder: 7, active: false });

    const taken = unique("Taken");
    await createStation(taken);
    const active = await createStation(unique("Active"));
    const collide = await req(
      `/stations/${active}`,
      { method: "PATCH", body: JSON.stringify({ name: taken }) },
      managerCookie,
    );
    expect(collide.status).toBe(409);
    expect(await collide.json()).toMatchObject({ error: { code: "station.name_taken" } });

    const empty = await req(`/stations/${active}`, { method: "PATCH", body: "{}" }, managerCookie);
    expect(empty.status).toBe(204);

    const unknown = await req(
      `/stations/${randomUUID()}`,
      { method: "PATCH", body: JSON.stringify({ name: unique("Y") }) },
      managerCookie,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "station.not_found" } });
    const malformed = await req(
      "/stations/not-a-uuid",
      { method: "PATCH", body: JSON.stringify({ name: unique("Z") }) },
      managerCookie,
    );
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({ error: { code: "station.not_found" } });
  });

  it("PATCH with only the rest of the order switch saves it and GET lists it", async () => {
    const id = await createStation(unique("Rest enabled"));
    const response = await req(
      `/stations/${id}`,
      { method: "PATCH", body: JSON.stringify({ showsRestOfOrder: true }) },
      managerCookie,
    );
    expect(response.status).toBe(204);
    expect((await listStations()).find((station) => station.id === id)).toMatchObject({
      showsRestOfOrder: true,
    });
  });

  it("PATCH refuses a non-boolean rest of the order switch", async () => {
    const id = await createStation(unique("Rest invalid"));
    const response = await req(
      `/stations/${id}`,
      { method: "PATCH", body: JSON.stringify({ showsRestOfOrder: "yes" }) },
      managerCookie,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "management.request_invalid",
        params: { field: "showsRestOfOrder" },
      },
    });
    expect((await listStations()).find((station) => station.id === id)).toMatchObject({
      showsRestOfOrder: false,
    });
  });

  it("PATCH body screens: array → body; non-string name; non-boolean active — the station is left as it was", async () => {
    const name = unique("Screened");
    const id = await createStation(name, { displayOrder: 3 });
    for (const [body, field] of [
      ["[]", "body"],
      [JSON.stringify({ name: 5 }), "name"],
      [JSON.stringify({ active: "no" }), "active"],
    ] as const) {
      const res = await req(`/stations/${id}`, { method: "PATCH", body }, managerCookie);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
    expect((await listStations()).find((s) => s.id === id)).toMatchObject({
      name,
      displayOrder: 3,
      active: true,
    });
  });

  it("PATCH saves independent thresholds, rejects non-positive values and names an invalid effective order", async () => {
    const id = await createStation(unique("Thresh"));
    const ok = await req(
      `/stations/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          warmAfterMinutes: 3,
          overdueAfterMinutes: 8,
          forgottenAfterMinutes: 12,
        }),
      },
      managerCookie,
    );
    expect(ok.status).toBe(204);
    const row = await suite.db.execute<{
      warm_after_minutes: number;
      overdue_after_minutes: number;
      forgotten_after_minutes: number;
    }>(
      sql`select warm_after_minutes, overdue_after_minutes, forgotten_after_minutes
        from kitchen_station_timing where station_id = ${id}`,
    );
    expect(row.rows[0]).toMatchObject({
      warm_after_minutes: 3,
      overdue_after_minutes: 8,
      forgotten_after_minutes: 12,
    });

    // A non-positive or non-integer value is refused on its own field, before the trio is checked.
    const nonPositive = await req(
      `/stations/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          warmAfterMinutes: 0,
          overdueAfterMinutes: 8,
          forgottenAfterMinutes: 12,
        }),
      },
      managerCookie,
    );
    expect(nonPositive.status).toBe(400);
    expect(await nonPositive.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "warmAfterMinutes" } },
    });

    const outOfOrder = await req(
      `/stations/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          warmAfterMinutes: 10,
          overdueAfterMinutes: 8,
          forgottenAfterMinutes: 12,
        }),
      },
      managerCookie,
    );
    expect(outOfOrder.status).toBe(400);
    expect(await outOfOrder.json()).toMatchObject({
      error: {
        code: "station.thresholds_invalid",
        params: { field: "overdueAfterMinutes", stationId: id },
      },
    });

    // Omitted fields retain their saved overrides.
    const partial = await req(
      `/stations/${id}`,
      { method: "PATCH", body: JSON.stringify({ warmAfterMinutes: 3 }) },
      managerCookie,
    );
    expect(partial.status).toBe(204);
    expect(await partial.text()).toBe("");

    const after = await suite.db.execute<{
      warm_after_minutes: number;
      overdue_after_minutes: number;
      forgotten_after_minutes: number;
    }>(
      sql`select warm_after_minutes, overdue_after_minutes, forgotten_after_minutes
        from kitchen_station_timing where station_id = ${id}`,
    );
    expect(after.rows[0]).toMatchObject({
      warm_after_minutes: 3,
      overdue_after_minutes: 8,
      forgotten_after_minutes: 12,
    });
  });

  it("DELETE deactivates a station (drops off the active list); unknown/malformed :id → 404", async () => {
    const id = await createStation(unique("Del"));
    expect((await listStations()).find((s) => s.id === id)).toBeDefined();
    const del = await req(`/stations/${id}`, { method: "DELETE" }, managerCookie);
    expect(del.status).toBe(204);
    expect((await listStations()).find((s) => s.id === id)).toBeUndefined();

    const unknown = await req(`/stations/${randomUUID()}`, { method: "DELETE" }, managerCookie);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "station.not_found" } });
    const malformed = await req("/stations/not-a-uuid", { method: "DELETE" }, managerCookie);
    expect(malformed.status).toBe(404);
  });

  it("PUT /bump-mode sets the venue's whole-ticket bump mode; a bad value → 400", async () => {
    const set = await req(
      "/bump-mode",
      { method: "PUT", body: JSON.stringify({ mode: "ticket" }) },
      managerCookie,
    );
    expect(set.status).toBe(204);
    const row = await suite.db.execute<{ bump_mode: string }>(
      sql`select bump_mode from locations where id = ${venue.locationId}`,
    );
    expect(row.rows[0]!.bump_mode).toBe("ticket");
    // Reset to the default so a later assertion on the shared venue is unaffected.
    await req(
      "/bump-mode",
      { method: "PUT", body: JSON.stringify({ mode: "line" }) },
      managerCookie,
    );

    const bad = await req(
      "/bump-mode",
      { method: "PUT", body: JSON.stringify({ mode: "banana" }) },
      managerCookie,
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "mode" } },
    });
  });

  it("GET /bump-mode reads the stored mode after a manager changes it", async () => {
    const initial = await req("/bump-mode", { method: "GET" }, managerCookie);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({ mode: "line" });
    await req(
      "/bump-mode",
      { method: "PUT", body: JSON.stringify({ mode: "ticket" }) },
      managerCookie,
    );
    try {
      const after = await req("/bump-mode", { method: "GET" }, managerCookie);
      expect(after.status).toBe(200);
      expect(await after.json()).toEqual({ mode: "ticket" });
    } finally {
      await req(
        "/bump-mode",
        { method: "PUT", body: JSON.stringify({ mode: "line" }) },
        managerCookie,
      );
    }
  });

  it("lets a manager read both station output lists", async () => {
    const res = await req("/stations/outputs-down", { method: "GET" }, managerCookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ printersDown: [], screensDark: [] });
  });

  it("a STAFF session is refused on every station/routing route (403 authorization.not_permitted)", async () => {
    // A staff person can log in but holds no `venue.configure`.
    const someId = randomUUID();
    const cases = [
      req("/stations", { method: "GET" }, staffCookie),
      req("/stations/outputs-down", { method: "GET" }, staffCookie),
      req(
        "/stations",
        { method: "POST", body: JSON.stringify({ name: unique("N") }) },
        staffCookie,
      ),
      req(
        `/stations/${someId}`,
        { method: "PATCH", body: JSON.stringify({ name: unique("Z") }) },
        staffCookie,
      ),
      req(`/stations/${someId}`, { method: "DELETE" }, staffCookie),
      req(`/stations/${someId}/default`, { method: "POST" }, staffCookie),
      req("/bump-mode", { method: "PUT", body: JSON.stringify({ mode: "line" }) }, staffCookie),
      req("/bump-mode", { method: "GET" }, staffCookie),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    }
  });

  it("no session → 401 management_session.required on every station/routing route", async () => {
    const someId = randomUUID();
    const cases = [
      req("/stations", { method: "GET" }, undefined),
      req("/stations/outputs-down", { method: "GET" }, undefined),
      req("/stations", { method: "POST", body: JSON.stringify({ name: "N" }) }, undefined),
      req(
        `/stations/${someId}`,
        { method: "PATCH", body: JSON.stringify({ name: "Z" }) },
        undefined,
      ),
      req(`/stations/${someId}`, { method: "DELETE" }, undefined),
      req(`/stations/${someId}/default`, { method: "POST" }, undefined),
      req("/bump-mode", { method: "PUT", body: JSON.stringify({ mode: "line" }) }, undefined),
      req("/bump-mode", { method: "GET" }, undefined),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "management_session.required" } });
    }
  });

  describe("a station's printers save with the station", () => {
    async function addPrinter(active = true): Promise<string> {
      const [row] = await suite.db
        .insert(printers)
        .values({
          locationId: venue.locationId,
          name: unique("Ticket printer"),
          transport: "network_tcp",
          host: "10.0.0.20",
          active,
        })
        .returning({ id: printers.id });
      return row!.id;
    }

    async function printersOf(stationId: string): Promise<string[]> {
      const rows = await suite.db
        .select({ printerId: stationPrinters.printerId })
        .from(stationPrinters)
        .where(eq(stationPrinters.stationId, stationId));
      return rows.map((row) => row.printerId).sort();
    }

    async function stationName(id: string): Promise<string | undefined> {
      const [row] = await suite.db
        .select({ name: kitchenStations.name })
        .from(kitchenStations)
        .where(eq(kitchenStations.id, id));
      return row?.name;
    }

    function patch(id: string, body: unknown): Promise<Response> {
      return req(`/stations/${id}`, { method: "PATCH", body: JSON.stringify(body) }, managerCookie);
    }

    it("a PATCH stores a new name and two printers together", async () => {
      const id = await createStation(unique("Grill"));
      const [a, b] = [await addPrinter(), await addPrinter()];
      const name = unique("Grill renamed");
      const res = await patch(id, { name, printerIds: [a, b] });
      expect(res.status).toBe(204);
      expect(await stationName(id)).toBe(name);
      expect(await printersOf(id)).toEqual([a, b].sort());
    });

    it("a PATCH carrying only printerIds is a change: it replaces the station's printers", async () => {
      const id = await createStation(unique("Fryer"));
      const [a, b] = [await addPrinter(), await addPrinter()];
      expect((await patch(id, { printerIds: [a] })).status).toBe(204);
      expect(await printersOf(id)).toEqual([a]);
      expect((await patch(id, { printerIds: [b] })).status).toBe(204);
      expect(await printersOf(id)).toEqual([b]);
      expect((await patch(id, { printerIds: [] })).status).toBe(204);
      expect(await printersOf(id)).toEqual([]);
    });

    it("without printer.manage, a PATCH with printers is refused and writes nothing, while a name alone saves", async () => {
      const original = unique("Pastry");
      const id = await createStation(original);
      const kept = await addPrinter();
      expect((await patch(id, { printerIds: [kept] })).status).toBe(204);
      const other = await addPrinter();
      printerGate.deny = true;
      try {
        const refused = await patch(id, { name: unique("Pastry refused"), printerIds: [other] });
        expect(refused.status).toBe(403);
        expect(await refused.json()).toMatchObject({
          error: { code: "authorization.not_permitted", params: { permission: "printer.manage" } },
        });
        expect(await stationName(id)).toBe(original);
        expect(await printersOf(id)).toEqual([kept]);

        const renamed = unique("Pastry renamed");
        expect((await patch(id, { name: renamed })).status).toBe(204);
        expect(await stationName(id)).toBe(renamed);
        expect(await printersOf(id)).toEqual([kept]);
      } finally {
        printerGate.deny = false;
      }
    });

    it("a watcher's printer is refused printer.makes_and_watches and the old name is kept", async () => {
      const original = unique("Bar");
      const id = await createStation(original);
      const watched = await addPrinter();
      const created = await req(
        "/watchers",
        {
          method: "POST",
          body: JSON.stringify({
            name: unique("Pass"),
            everyStation: true,
            stationIds: [],
            everyZone: true,
            zoneIds: [],
            runsPass: true,
            displayOrder: 3,
          }),
        },
        managerCookie,
      );
      expect(created.status).toBe(201);
      const watcherId = ((await created.json()) as { id: string }).id;
      await suite.db.insert(watcherPrinters).values({ watcherId, printerId: watched });
      const free = await addPrinter();

      const res = await patch(id, { name: unique("Bar refused"), printerIds: [free, watched] });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        error: { code: "printer.makes_and_watches", params: { id: watched } },
      });
      expect(await stationName(id)).toBe(original);
      expect(await printersOf(id)).toEqual([]);
    });

    it("a switched-off printer is refused printer.not_found and the old name is kept", async () => {
      const original = unique("Cold");
      const id = await createStation(original);
      const off = await addPrinter(false);
      const res = await patch(id, { name: unique("Cold refused"), printerIds: [off] });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        error: { code: "printer.not_found", params: { id: off } },
      });
      expect(await stationName(id)).toBe(original);
      expect(await printersOf(id)).toEqual([]);
    });

    it("a switched-off station's name can still be edited when no printers are sent", async () => {
      const id = await createStation(unique("Retired"));
      expect((await req(`/stations/${id}`, { method: "DELETE" }, managerCookie)).status).toBe(204);
      const renamed = unique("Retired renamed");
      expect((await patch(id, { name: renamed })).status).toBe(204);
      expect(await stationName(id)).toBe(renamed);
    });

    it("refuses a malformed printerIds before any write", async () => {
      const original = unique("Wok");
      const id = await createStation(original);
      const a = await addPrinter();
      for (const printerIds of [null, "x", [1], [a, a]]) {
        const res = await patch(id, { name: unique("Wok refused"), printerIds });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
          error: { code: "management.request_invalid", params: { field: "printerIds" } },
        });
      }
      const res = await patch(id, { name: unique("Wok refused"), printerIds: ["not-a-uuid"] });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "shared.invalid_id" } });
      expect(await stationName(id)).toBe(original);
      expect(await printersOf(id)).toEqual([]);
    });

    it("a POST with printers creates the station with them", async () => {
      const [a, b] = [await addPrinter(), await addPrinter()];
      const res = await req(
        "/stations",
        { method: "POST", body: JSON.stringify({ name: unique("New"), printerIds: [a, b] }) },
        managerCookie,
      );
      expect(res.status).toBe(201);
      const { id } = (await res.json()) as { id: string };
      expect(await printersOf(id)).toEqual([a, b].sort());
    });

    it("a POST with printers is refused without printer.manage, or with a switched-off printer, and creates no station", async () => {
      const a = await addPrinter();
      const name = unique("Never");
      printerGate.deny = true;
      try {
        const refused = await req(
          "/stations",
          { method: "POST", body: JSON.stringify({ name, printerIds: [a] }) },
          managerCookie,
        );
        expect(refused.status).toBe(403);
        expect(await refused.json()).toMatchObject({
          error: { code: "authorization.not_permitted", params: { permission: "printer.manage" } },
        });
      } finally {
        printerGate.deny = false;
      }
      const off = await addPrinter(false);
      const notFound = await req(
        "/stations",
        { method: "POST", body: JSON.stringify({ name, printerIds: [a, off] }) },
        managerCookie,
      );
      expect(notFound.status).toBe(404);
      expect(
        await suite.db
          .select({ id: kitchenStations.id })
          .from(kitchenStations)
          .where(eq(kitchenStations.name, name)),
      ).toEqual([]);
      expect(
        await suite.db
          .select({ id: stationPrinters.stationId })
          .from(stationPrinters)
          .where(eq(stationPrinters.printerId, a)),
      ).toEqual([]);
    });
  });
});

describe("/management-api/courses + product course + fire-control (KDS-2 config)", () => {
  async function createCourse(
    name: string,
    extra: { displayOrder?: number } = {},
  ): Promise<string> {
    const res = await req(
      "/courses",
      { method: "POST", body: JSON.stringify({ name, ...extra }) },
      managerCookie,
    );
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  async function listCourses(): Promise<
    { id: string; name: string; displayOrder: number; active: boolean }[]
  > {
    return (await (await req("/courses", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      name: string;
      displayOrder: number;
      active: boolean;
    }[];
  }

  it("POST creates (201 { id }) + GET lists it, active, at its display order (manager)", async () => {
    const name = unique("Entrantes");
    const id = await createCourse(name, { displayOrder: 3 });
    const found = (await listCourses()).find((c) => c.id === id);
    expect(found).toMatchObject({ name, displayOrder: 3, active: true });
  });

  it("POST with a duplicate name → 409 course.name_taken", async () => {
    const name = unique("dupcourse");
    await createCourse(name);
    const dup = await req(
      "/courses",
      { method: "POST", body: JSON.stringify({ name }) },
      managerCookie,
    );
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: { code: "course.name_taken" } });
  });

  it("POST body-shape faults → 400 management.request_invalid (non-object, missing name)", async () => {
    const nullBody = await req("/courses", { method: "POST", body: "null" }, managerCookie);
    expect(nullBody.status).toBe(400);
    expect(await nullBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "name" } },
    });
    const arrayBody = await req("/courses", { method: "POST", body: "[]" }, managerCookie);
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });
  });

  it("PATCH edits name/displayOrder/active; a rename collision → 409; empty patch → 204 no-op; unknown/malformed :id → 404", async () => {
    const id = await createCourse(unique("Edit"));
    const patch = await req(
      `/courses/${id}`,
      { method: "PATCH", body: JSON.stringify({ displayOrder: 9, active: false }) },
      managerCookie,
    );
    expect(patch.status).toBe(204);
    // Through the table definition, as in the station twin above.
    const [row] = await suite.db
      .select({ displayOrder: kitchenCourses.displayOrder, active: kitchenCourses.active })
      .from(kitchenCourses)
      .where(eq(kitchenCourses.id, id));
    expect(row).toMatchObject({ displayOrder: 9, active: false });

    const taken = unique("Taken");
    await createCourse(taken);
    const active = await createCourse(unique("Active"));
    const collide = await req(
      `/courses/${active}`,
      { method: "PATCH", body: JSON.stringify({ name: taken }) },
      managerCookie,
    );
    expect(collide.status).toBe(409);
    expect(await collide.json()).toMatchObject({ error: { code: "course.name_taken" } });

    const empty = await req(`/courses/${active}`, { method: "PATCH", body: "{}" }, managerCookie);
    expect(empty.status).toBe(204);

    const arrayBody = await req(
      `/courses/${active}`,
      { method: "PATCH", body: "[]" },
      managerCookie,
    );
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });

    const unknown = await req(
      `/courses/${randomUUID()}`,
      { method: "PATCH", body: JSON.stringify({ name: unique("Y") }) },
      managerCookie,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "course.not_found" } });
    const malformed = await req(
      "/courses/not-a-uuid",
      { method: "PATCH", body: JSON.stringify({ name: unique("Z") }) },
      managerCookie,
    );
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({ error: { code: "course.not_found" } });
  });

  it("PATCH refuses a non-string name or a non-boolean active, leaving the course as it was", async () => {
    const name = unique("Screened");
    const id = await createCourse(name);
    for (const [body, field] of [
      [{ name: 5 }, "name"],
      [{ active: "no" }, "active"],
    ] as const) {
      const res = await req(
        `/courses/${id}`,
        { method: "PATCH", body: JSON.stringify(body) },
        managerCookie,
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
    const [row] = await suite.db
      .select({ name: kitchenCourses.name, active: kitchenCourses.active })
      .from(kitchenCourses)
      .where(eq(kitchenCourses.id, id));
    expect(row).toEqual({ name, active: true });
  });

  it("DELETE deletes a course nothing refers to; unknown/malformed :id → 404", async () => {
    const id = await createCourse(unique("Del"));
    expect((await listCourses()).find((c) => c.id === id)).toBeDefined();
    const del = await req(`/courses/${id}`, { method: "DELETE" }, managerCookie);
    expect(del.status).toBe(204);
    expect((await listCourses()).find((c) => c.id === id)).toBeUndefined();
    expect(await suite.db.select().from(kitchenCourses).where(eq(kitchenCourses.id, id))).toEqual(
      [],
    );

    const unknown = await req(`/courses/${randomUUID()}`, { method: "DELETE" }, managerCookie);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "course.not_found" } });
    const malformed = await req("/courses/not-a-uuid", { method: "DELETE" }, managerCookie);
    expect(malformed.status).toBe(404);
  });

  it("DELETE disables a course a product names; only ?includeDisabled=true lists it, and PATCH enables it", async () => {
    const used = await createCourse(unique("Used"));
    const unused = await createCourse(unique("Unused"));
    const productId = await withTransaction(suite.db, async (tx) => {
      const catalogue = await createCatalogue(tx, { name: unique("Carta") });
      const category = await createCategory(tx, { name: unique("Cat") });
      const product = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: category.id,
        name: unique("Prod"),
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      return product.id;
    });
    const put = await req(
      `/products/${productId}/course`,
      { method: "PUT", body: JSON.stringify({ courseId: used }) },
      managerCookie,
    );
    expect(put.status).toBe(204);
    expect((await listCourses()).every((c) => !("inUse" in c))).toBe(true);
    const listed = (await (
      await req("/courses?includeDisabled=true", { method: "GET" }, managerCookie)
    ).json()) as {
      id: string;
      inUse: boolean;
    }[];
    expect(listed.find((c) => c.id === used)).toMatchObject({ active: true, inUse: true });
    expect(listed.find((c) => c.id === unused)).toMatchObject({ active: true, inUse: false });
    expect(listed.every((c) => typeof c.inUse === "boolean")).toBe(true);

    expect((await req(`/courses/${used}`, { method: "DELETE" }, managerCookie)).status).toBe(204);
    expect((await listCourses()).find((c) => c.id === used)).toBeUndefined();
    const all = (await (
      await req("/courses?includeDisabled=true", { method: "GET" }, managerCookie)
    ).json()) as { id: string; active: boolean; inUse: boolean }[];
    expect(all.find((c) => c.id === used)).toMatchObject({ active: false, inUse: true });
    expect(all.find((c) => c.id === unused)).toMatchObject({ active: true, inUse: false });
    expect((await req(`/courses/${used}`, { method: "DELETE" }, managerCookie)).status).toBe(204);

    const enable = await req(
      `/courses/${used}`,
      { method: "PATCH", body: JSON.stringify({ active: true }) },
      managerCookie,
    );
    expect(enable.status).toBe(204);
    expect((await listCourses()).find((c) => c.id === used)).toMatchObject({ active: true });
  });

  it("DELETE ?disable=true keeps a course nothing refers to, disabled; a malformed flag → 400, changing nothing", async () => {
    const id = await createCourse(unique("Kept"));
    const row = () =>
      suite.db
        .select({ active: kitchenCourses.active })
        .from(kitchenCourses)
        .where(eq(kitchenCourses.id, id));
    const refused = await req(`/courses/${id}?disable=1`, { method: "DELETE" }, managerCookie);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "disable" } },
    });
    expect(await row()).toEqual([{ active: true }]);
    const res = await req(`/courses/${id}?disable=true`, { method: "DELETE" }, managerCookie);
    expect(res.status).toBe(204);
    expect(await row()).toEqual([{ active: false }]);
  });

  it("PATCH refuses another venue's course with 404 course.not_found, changing nothing", async () => {
    const foreign = await withTransaction(suite.db, async (tx) => {
      const [location] = await tx
        .insert(locations)
        .values({
          name: unique("Elsewhere"),
          invoiceLocales: ["es-ES"],
          operationDescription: "Bar",
        })
        .returning({ id: locations.id });
      const [course] = await tx
        .insert(kitchenCourses)
        .values({ locationId: location!.id, name: "Brunch", active: false })
        .returning({ id: kitchenCourses.id });
      return course!.id;
    });
    const res = await req(
      `/courses/${foreign}`,
      { method: "PATCH", body: JSON.stringify({ active: true, name: unique("Taken") }) },
      managerCookie,
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: "course.not_found", params: { courseId: foreign } },
    });
    expect(
      await suite.db
        .select({ name: kitchenCourses.name, active: kitchenCourses.active })
        .from(kitchenCourses)
        .where(eq(kitchenCourses.id, foreign)),
    ).toEqual([{ name: "Brunch", active: false }]);
  });

  it("PUT /courses/:id/position moves a course and answers the venue's active courses renumbered", async () => {
    const id = await createCourse(unique("Moved"), { displayOrder: 1_000_000 });
    const res = await req(
      `/courses/${id}/position`,
      { method: "PUT", body: JSON.stringify({ to: 0 }) },
      managerCookie,
    );
    expect(res.status).toBe(200);
    const moved = (await res.json()) as { id: string; displayOrder: number }[];
    expect(moved[0]!.id).toBe(id);
    expect(moved.map((c) => c.displayOrder)).toEqual(moved.map((_, index) => index));
    const withDisabled = (await (
      await req("/courses?includeDisabled=true", { method: "GET" }, managerCookie)
    ).json()) as { active: boolean; inUse: boolean }[];
    expect(moved).toEqual(withDisabled.filter((c) => c.active));
    expect(moved.every((c) => typeof (c as { inUse?: unknown }).inUse === "boolean")).toBe(true);
  });

  it("PUT /courses/:id/position refuses a `to` that is not a non-negative integer, or a non-object body, leaving the order as it was", async () => {
    const id = await createCourse(unique("Unmoved"));
    const before = await listCourses();
    for (const [body, field] of [
      [JSON.stringify({ to: -1 }), "to"],
      [JSON.stringify({ to: 1.5 }), "to"],
      [JSON.stringify({ to: "1" }), "to"],
      [JSON.stringify({}), "to"],
      ["null", "to"],
      ["[]", "body"],
      ["5", "body"],
    ] as const) {
      const res = await req(`/courses/${id}/position`, { method: "PUT", body }, managerCookie);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
    expect(await listCourses()).toEqual(before);
  });

  it("PUT /courses/:id/position on an unknown, retired or malformed :id → 404 course.not_found", async () => {
    const retired = await createCourse(unique("Retired"));
    await req(
      `/courses/${retired}`,
      { method: "PATCH", body: JSON.stringify({ active: false }) },
      managerCookie,
    );
    for (const id of [randomUUID(), retired, "not-a-uuid"]) {
      const res = await req(
        `/courses/${id}/position`,
        { method: "PUT", body: JSON.stringify({ to: 0 }) },
        managerCookie,
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        error: { code: "course.not_found", params: { courseId: id } },
      });
    }
  });

  it("PUT /products/:id/course sets + clears the product's default course; bad body → 400; a bad/retired course → 404; a malformed product → 404 product.not_found", async () => {
    const courseId = await createCourse(unique("Course"));
    const { productId } = await withTransaction(suite.db, async (tx) => {
      const catalogue = await createCatalogue(tx, {
        name: unique("Carta"),
      });
      const category = await createCategory(tx, {
        name: unique("Cat"),
      });
      const product = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: category.id,
        name: unique("Prod"),
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      return { productId: product.id };
    });

    const courseOf = async (id: string): Promise<string | null> => {
      const r = await suite.db.execute<{ course_id: string | null }>(
        sql`select course_id from products where id = ${id}`,
      );
      return r.rows[0]!.course_id;
    };
    const put = (body: unknown, id = productId) =>
      req(`/products/${id}/course`, { method: "PUT", body: JSON.stringify(body) }, managerCookie);

    expect((await put({ courseId })).status).toBe(204);
    expect(await courseOf(productId)).toBe(courseId);
    expect((await put({ courseId: null })).status).toBe(204);
    expect(await courseOf(productId)).toBeNull();
    const badType = await put({ courseId: 5 });
    expect(badType.status).toBe(400);
    expect(await badType.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "courseId" } },
    });
    const badCourse = await put({ courseId: "not-a-uuid" });
    expect(badCourse.status).toBe(404);
    expect(await badCourse.json()).toMatchObject({ error: { code: "course.not_found" } });
    const missingCourse = await put({ courseId: randomUUID() });
    expect(missingCourse.status).toBe(404);
    expect(await missingCourse.json()).toMatchObject({ error: { code: "course.not_found" } });
    const malformed = await put({ courseId }, "not-a-uuid");
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({
      error: { code: "product.not_found", params: { productId: "not-a-uuid" } },
    });
  });

  it("PUT /products/:id/course on an unknown or a variant's :id → 404 product.not_found", async () => {
    const courseId = await createCourse(unique("Course"));
    const { variantId } = await withTransaction(suite.db, async (tx) => {
      const catalogue = await createCatalogue(tx, { name: unique("Carta") });
      const product = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: null,
        name: unique("Prod"),
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      const [variant] = await tx
        .insert(products)
        .values({ catalogueId: catalogue.id, parentId: product.id, name: unique("Variant") })
        .returning({ id: products.id });
      return { variantId: variant!.id };
    });
    const put = (id: string, body: unknown) =>
      req(`/products/${id}/course`, { method: "PUT", body: JSON.stringify(body) }, managerCookie);
    for (const id of [randomUUID(), variantId]) {
      const res = await put(id, { courseId });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        error: { code: "product.not_found", params: { productId: id } },
      });
    }
  });

  it("PUT /products/:id/course refuses an archived product with 409 product.archived and retains its course", async () => {
    const courseId = await createCourse(unique("Archive course"));
    const productId = await withTransaction(suite.db, async (tx) => {
      const catalogue = await createCatalogue(tx, { name: unique("Archive menu") });
      const product = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: null,
        name: unique("Archived dish"),
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      await tx.update(products).set({ active: false, courseId }).where(eq(products.id, product.id));
      return product.id;
    });
    for (const next of [null, randomUUID()]) {
      const response = await req(
        `/products/${productId}/course`,
        {
          method: "PUT",
          body: JSON.stringify({ courseId: next }),
        },
        managerCookie,
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: { code: "product.archived", params: { productId } },
      });
      expect(
        await suite.db
          .select({ courseId: products.courseId })
          .from(products)
          .where(eq(products.id, productId)),
      ).toEqual([{ courseId }]);
    }
  });

  it("PUT /products/:id/course names the product before the course", async () => {
    const unknown = randomUUID();
    for (const [id, courseId] of [
      ["not-a-uuid", "not-a-uuid"],
      [unknown, randomUUID()],
    ] as const) {
      const res = await req(
        `/products/${id}/course`,
        { method: "PUT", body: JSON.stringify({ courseId }) },
        managerCookie,
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        error: { code: "product.not_found", params: { productId: id } },
      });
    }
  });

  it("GET /fire-control reads the venue setting (defaults 'waiter'); PUT sets it; a bad value → 400", async () => {
    const initial = await req("/fire-control", { method: "GET" }, managerCookie);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({ mode: "waiter" });

    const set = await req(
      "/fire-control",
      { method: "PUT", body: JSON.stringify({ mode: "kitchen" }) },
      managerCookie,
    );
    expect(set.status).toBe(204);
    const after = await req("/fire-control", { method: "GET" }, managerCookie);
    expect(await after.json()).toEqual({ mode: "kitchen" });
    const row = await suite.db.execute<{ fire_control: string }>(
      sql`select fire_control from locations where id = ${venue.locationId}`,
    );
    expect(row.rows[0]!.fire_control).toBe("kitchen");
    // Reset to the default so a later assertion on the shared venue is unaffected.
    await req(
      "/fire-control",
      { method: "PUT", body: JSON.stringify({ mode: "waiter" }) },
      managerCookie,
    );

    const bad = await req(
      "/fire-control",
      { method: "PUT", body: JSON.stringify({ mode: "banana" }) },
      managerCookie,
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "mode" } },
    });
  });

  it("PUT /fire-control accepts the KDS-3 'expo' mode and round-trips it", async () => {
    const set = await req(
      "/fire-control",
      { method: "PUT", body: JSON.stringify({ mode: "expo" }) },
      managerCookie,
    );
    expect(set.status).toBe(204);
    const after = await req("/fire-control", { method: "GET" }, managerCookie);
    expect(await after.json()).toEqual({ mode: "expo" });
    const row = await suite.db.execute<{ fire_control: string }>(
      sql`select fire_control from locations where id = ${venue.locationId}`,
    );
    expect(row.rows[0]!.fire_control).toBe("expo");
    // Reset to the default so a later assertion on the shared venue is unaffected.
    await req(
      "/fire-control",
      { method: "PUT", body: JSON.stringify({ mode: "waiter" }) },
      managerCookie,
    );
  });

  it("a STAFF session is refused on every course/product-course/fire-control route (403 authorization.not_permitted)", async () => {
    // A staff person can log in but holds no `venue.configure`.
    const someId = randomUUID();
    const cases = [
      req("/courses", { method: "GET" }, staffCookie),
      req("/courses", { method: "POST", body: JSON.stringify({ name: unique("N") }) }, staffCookie),
      req(
        `/courses/${someId}`,
        { method: "PATCH", body: JSON.stringify({ name: unique("Z") }) },
        staffCookie,
      ),
      req(`/courses/${someId}`, { method: "DELETE" }, staffCookie),
      req(
        `/courses/${someId}/position`,
        { method: "PUT", body: JSON.stringify({ to: 0 }) },
        staffCookie,
      ),
      req(
        `/products/${someId}/course`,
        { method: "PUT", body: JSON.stringify({ courseId: null }) },
        staffCookie,
      ),
      req("/fire-control", { method: "GET" }, staffCookie),
      req(
        "/fire-control",
        { method: "PUT", body: JSON.stringify({ mode: "waiter" }) },
        staffCookie,
      ),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    }
  });

  it("no session → 401 management_session.required on every course/product-course/fire-control route", async () => {
    const someId = randomUUID();
    const cases = [
      req("/courses", { method: "GET" }, undefined),
      req("/courses", { method: "POST", body: JSON.stringify({ name: "N" }) }, undefined),
      req(
        `/courses/${someId}`,
        { method: "PATCH", body: JSON.stringify({ name: "Z" }) },
        undefined,
      ),
      req(`/courses/${someId}`, { method: "DELETE" }, undefined),
      req(
        `/courses/${someId}/position`,
        { method: "PUT", body: JSON.stringify({ to: 0 }) },
        undefined,
      ),
      req(
        `/products/${someId}/course`,
        { method: "PUT", body: JSON.stringify({ courseId: null }) },
        undefined,
      ),
      req("/fire-control", { method: "GET" }, undefined),
      req("/fire-control", { method: "PUT", body: JSON.stringify({ mode: "waiter" }) }, undefined),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "management_session.required" } });
    }
  });
});

describe("venue late-flag defaults", () => {
  const initial = { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 };
  const changed = { warmAfterMinutes: 3, overdueAfterMinutes: 8, forgottenAfterMinutes: 12 };
  const read = async () => {
    const response = await req("/kitchen-timing-defaults", { method: "GET" }, supervisorCookie);
    expect(response.status).toBe(200);
    return response.json();
  };
  const write = (body: unknown, cookie = managerCookie) =>
    req("/kitchen-timing-defaults", { method: "PUT", body: JSON.stringify(body) }, cookie);
  const reset = () =>
    suite.db.execute(sql`update kitchen_timing_defaults
    set warm_after_minutes = 5, overdue_after_minutes = 10, forgotten_after_minutes = 15
    where location_id = ${venue.locationId}`);

  it("reads provisioned defaults, saves replacements and grants supervisors read access only", async () => {
    expect(await read()).toEqual(initial);
    for (const cookie of [staffCookie, supervisorCookie]) {
      expect((await write(changed, cookie)).status).toBe(403);
      expect(await read()).toEqual(initial);
    }
    expect((await write(changed, "")).status).toBe(401);
    try {
      expect((await write(changed)).status).toBe(204);
      expect(await read()).toEqual(changed);
    } finally {
      await reset();
    }
  });

  it.each([
    ["body", null],
    ["body", []],
    ["warmAfterMinutes", { ...changed, warmAfterMinutes: null }],
    ["warmAfterMinutes", { ...changed, warmAfterMinutes: "3" }],
    ["warmAfterMinutes", { ...changed, warmAfterMinutes: [3] }],
    ["warmAfterMinutes", { ...changed, warmAfterMinutes: 0 }],
    ["warmAfterMinutes", { ...changed, warmAfterMinutes: 1.5 }],
    ["warmAfterMinutes", { ...changed, warmAfterMinutes: 2147483648 }],
    ["warmAfterMinutes", { overdueAfterMinutes: 8, forgottenAfterMinutes: 12 }],
    ["overdueAfterMinutes", { ...changed, overdueAfterMinutes: 3 }],
    ["forgottenAfterMinutes", { ...changed, forgottenAfterMinutes: 8 }],
  ])("refuses invalid %s without changing defaults (%j)", async (field, body) => {
    const response = await write(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field } },
    });
    expect(await read()).toEqual(initial);
  });

  it.each([true, false])(
    "refuses defaults that invert a station override, including active=%s",
    async (active) => {
      const name = unique("Partial override");
      const [station] = await suite.db
        .insert(kitchenStations)
        .values({
          locationId: venue.locationId,
          name,
          active,
        })
        .returning({ id: kitchenStations.id });
      await suite.db.insert(kitchenStationTiming).values({
        stationId: station!.id,
        overdueAfterMinutes: 7,
      });
      try {
        const response = await write({ ...initial, warmAfterMinutes: 7 });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          error: {
            code: "station.thresholds_invalid",
            params: { field: "overdueAfterMinutes", stationId: station!.id, name },
          },
        });
        expect(await read()).toEqual(initial);
        expect((await write(changed)).status).toBe(204);
        expect(await read()).toEqual(changed);
        const [timing] = await suite.db
          .select()
          .from(kitchenStationTiming)
          .where(eq(kitchenStationTiming.stationId, station!.id));
        expect(timing).toEqual({
          stationId: station!.id,
          warmAfterMinutes: null,
          overdueAfterMinutes: 7,
          forgottenAfterMinutes: null,
        });
      } finally {
        await suite.db
          .delete(kitchenStationTiming)
          .where(eq(kitchenStationTiming.stationId, station!.id));
        await reset();
      }
    },
  );
});

it("a zone rename onto a disabled name answers 409 with the existing zone id", async () => {
  const name = unique("Disabled terrace");
  const target = (await (
    await req(
      "/venue-service/zones",
      { method: "POST", body: JSON.stringify({ name }) },
      managerCookie,
    )
  ).json()) as { id: string };
  const source = (await (
    await req(
      "/venue-service/zones",
      { method: "POST", body: JSON.stringify({ name: unique("Dining") }) },
      managerCookie,
    )
  ).json()) as { id: string };
  expect((await req(`/zones/${target.id}`, { method: "DELETE" }, managerCookie)).status).toBe(204);
  const response = await req(
    `/zones/${source.id}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
    managerCookie,
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: { code: "zone.name_disabled", params: { name, zoneId: target.id } },
  });
});

it("renames a disabled zone through the management route without enabling it", async () => {
  const created = await req(
    "/venue-service/zones",
    { method: "POST", body: JSON.stringify({ name: unique("Rename disabled") }) },
    managerCookie,
  );
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  expect((await req(`/zones/${id}`, { method: "DELETE" }, managerCookie)).status).toBe(204);
  const name = unique("Renamed disabled");
  expect(
    (await req(`/zones/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }, managerCookie))
      .status,
  ).toBe(204);
  const rows = (await (
    await req("/zones?includeInactive=true", { method: "GET" }, managerCookie)
  ).json()) as { id: string; name: string; active: boolean }[];
  expect(rows.find((row) => row.id === id)).toMatchObject({ name, active: false });
});
