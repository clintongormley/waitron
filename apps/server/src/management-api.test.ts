import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { kitchenCourses, kitchenStations, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { createCatalogue, createCategory, createProduct } from "@waitron/catalogue";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { mountManagementApi } from "./management-api.js";

/**
 * Floor zones, dining tables, table placement, kitchen stations and kitchen courses on the
 * `/management-api` surface, end to end over HTTP with the manager and staff sessions a real
 * sign-in mints.
 *
 * The malformed-id and malformed-`zoneId` cases pin the response only: a `text` id column matches no
 * row for a malformed id, so none of them tells its screen from its absence.
 */
const LOCALE = "es-ES";
const PASSWORD = "correct horse";
const MANAGER_EMAIL = "manager@x.com";
const STAFF_EMAIL = "clerk@x.com";

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
        tillName: "Caja 1",
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
    const seed = async (displayName: string, email: string, role: "manager" | "staff") => {
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
    return {
      managerId: await seed("The Manager", MANAGER_EMAIL, "manager"),
      staffId: await seed("The Clerk", STAFF_EMAIL, "staff"),
    };
  });
  return { venue, managerId, staffId };
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
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
    },
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
const json = { "content-type": "application/json" };

beforeAll(async () => {
  const setup = await setupTenant();
  venue = setup.venue;
  app = mountApp(venue);
  managerCookie = await login(app, MANAGER_EMAIL);
  staffCookie = await login(app, STAFF_EMAIL);
});

async function req(path: string, init: RequestInit, cookie?: string): Promise<Response> {
  return app.request(`/management-api${path}`, {
    ...init,
    headers: { ...json, ...(cookie ? { cookie } : {}), ...init.headers },
  });
}

async function createZone(name: string): Promise<string> {
  const res = await req(
    "/zones",
    { method: "POST", body: JSON.stringify({ name }) },
    managerCookie,
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe("/management-api/zones", () => {
  it("POST creates (201 { id }) + GET lists it (manager)", async () => {
    const name = unique("Comedor");
    const create = await req(
      "/zones",
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
      await req("/zones", { method: "POST", body: JSON.stringify({ name }) }, managerCookie)
    ).json()) as { id: string };
    const list = (await (await req("/zones", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      displayOrder: number;
    }[];
    expect(list.find((z) => z.id === id)).toMatchObject({ displayOrder: 0 });
  });

  it("POST with a duplicate name → 409 zone.name_taken", async () => {
    const name = unique("Barra");
    await req("/zones", { method: "POST", body: JSON.stringify({ name }) }, managerCookie);
    const dup = await req(
      "/zones",
      { method: "POST", body: JSON.stringify({ name }) },
      managerCookie,
    );
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: { code: "zone.name_taken" } });
  });

  it("POST body screens: null → field name, array → field body, non-string name, bad displayOrder", async () => {
    const nullBody = await req("/zones", { method: "POST", body: "null" }, managerCookie);
    expect(nullBody.status).toBe(400);
    expect(await nullBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "name" } },
    });

    const arrayBody = await req("/zones", { method: "POST", body: "[]" }, managerCookie);
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });

    const badName = await req(
      "/zones",
      { method: "POST", body: JSON.stringify({ name: 123 }) },
      managerCookie,
    );
    expect(badName.status).toBe(400);
    expect(await badName.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "name" } },
    });

    const badOrder = await req(
      "/zones",
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
        "/zones",
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
      req("/zones", { method: "POST", body: JSON.stringify({ name: "Nope" }) }, undefined),
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
    { id: string; name: string; displayOrder: number; isDefault: boolean; active: boolean }[]
  > {
    return (await (await req("/stations", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      name: string;
      displayOrder: number;
      isDefault: boolean;
      active: boolean;
    }[];
  }

  it("POST creates (201 { id }) + GET lists it, active, at its display order (manager)", async () => {
    const name = unique("Cocina");
    const id = await createStation(name, { displayOrder: 2 });
    const found = (await listStations()).find((s) => s.id === id);
    expect(found).toMatchObject({ name, displayOrder: 2, isDefault: false, active: true });
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

  it("PATCH edits the warm/overdue/forgotten thresholds together; a non-positive value, an out-of-order set, or a partial trio → 400 management.request_invalid", async () => {
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
        from kitchen_stations where id = ${id}`,
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
        code: "management.request_invalid",
        params: { field: "warmAfterMinutes|overdueAfterMinutes|forgottenAfterMinutes" },
      },
    });

    // A partial trio is refused like an out-of-order one, under the same compound field name.
    const partial = await req(
      `/stations/${id}`,
      { method: "PATCH", body: JSON.stringify({ warmAfterMinutes: 3 }) },
      managerCookie,
    );
    expect(partial.status).toBe(400);
    expect(await partial.json()).toMatchObject({
      error: {
        code: "management.request_invalid",
        params: { field: "warmAfterMinutes|overdueAfterMinutes|forgottenAfterMinutes" },
      },
    });

    const after = await suite.db.execute<{
      warm_after_minutes: number;
      overdue_after_minutes: number;
      forgotten_after_minutes: number;
    }>(
      sql`select warm_after_minutes, overdue_after_minutes, forgotten_after_minutes
        from kitchen_stations where id = ${id}`,
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

  it("PUT /categories/:id/station and /products/:id/station set + clear the route; bad body/station → 400/404; a malformed target is a no-op", async () => {
    const stationId = await createStation(unique("Route"));
    const { categoryId, productId } = await withTransaction(suite.db, async (tx) => {
      const catalogue = await createCatalogue(tx, {
        name: unique("Carta"),
      });
      const category = await createCategory(tx, {
        name: { [LOCALE]: unique("Cat") },
      });
      const product = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: category.id,
        name: unique("Prod"),
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      return { categoryId: category.id, productId: product.id };
    });

    const stationOf = async (
      table: "categories" | "products",
      id: string,
    ): Promise<string | null> => {
      // Two explicit reads rather than an interpolated table name: SQL is never built by concatenation.
      const r =
        table === "categories"
          ? await suite.db.execute<{ station_id: string | null }>(
              sql`select station_id from categories where id = ${id}`,
            )
          : await suite.db.execute<{ station_id: string | null }>(
              sql`select station_id from products where id = ${id}`,
            );
      return r.rows[0]!.station_id;
    };

    for (const [base, table, targetId] of [
      ["categories", "categories", categoryId],
      ["products", "products", productId],
    ] as const) {
      const put = (body: unknown, id = targetId) =>
        req(`/${base}/${id}/station`, { method: "PUT", body: JSON.stringify(body) }, managerCookie);

      expect((await put({ stationId })).status).toBe(204);
      expect(await stationOf(table, targetId)).toBe(stationId);
      expect((await put({ stationId: null })).status).toBe(204);
      expect(await stationOf(table, targetId)).toBeNull();
      const badType = await put({ stationId: 5 });
      expect(badType.status).toBe(400);
      expect(await badType.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "stationId" } },
      });
      const badStation = await put({ stationId: "not-a-uuid" });
      expect(badStation.status).toBe(404);
      expect(await badStation.json()).toMatchObject({ error: { code: "station.not_found" } });
      // A malformed TARGET id gets the verb's unknown-id no-op, a 204.
      expect((await put({ stationId }, "not-a-uuid")).status).toBe(204);
    }
  });

  it("a STAFF session is refused on every station/routing route (403 authorization.not_permitted)", async () => {
    // A staff person can log in but holds no `venue.configure`.
    const someId = randomUUID();
    const cases = [
      req("/stations", { method: "GET" }, staffCookie),
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
      req(
        `/categories/${someId}/station`,
        { method: "PUT", body: JSON.stringify({ stationId: null }) },
        staffCookie,
      ),
      req(
        `/products/${someId}/station`,
        { method: "PUT", body: JSON.stringify({ stationId: null }) },
        staffCookie,
      ),
      req("/bump-mode", { method: "PUT", body: JSON.stringify({ mode: "line" }) }, staffCookie),
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
      req("/stations", { method: "POST", body: JSON.stringify({ name: "N" }) }, undefined),
      req(
        `/stations/${someId}`,
        { method: "PATCH", body: JSON.stringify({ name: "Z" }) },
        undefined,
      ),
      req(`/stations/${someId}`, { method: "DELETE" }, undefined),
      req(`/stations/${someId}/default`, { method: "POST" }, undefined),
      req(
        `/categories/${someId}/station`,
        { method: "PUT", body: JSON.stringify({ stationId: null }) },
        undefined,
      ),
      req(
        `/products/${someId}/station`,
        { method: "PUT", body: JSON.stringify({ stationId: null }) },
        undefined,
      ),
      req("/bump-mode", { method: "PUT", body: JSON.stringify({ mode: "line" }) }, undefined),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "management_session.required" } });
    }
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

  it("DELETE deactivates a course (drops off the active list); unknown/malformed :id → 404", async () => {
    const id = await createCourse(unique("Del"));
    expect((await listCourses()).find((c) => c.id === id)).toBeDefined();
    const del = await req(`/courses/${id}`, { method: "DELETE" }, managerCookie);
    expect(del.status).toBe(204);
    expect((await listCourses()).find((c) => c.id === id)).toBeUndefined();

    const unknown = await req(`/courses/${randomUUID()}`, { method: "DELETE" }, managerCookie);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "course.not_found" } });
    const malformed = await req("/courses/not-a-uuid", { method: "DELETE" }, managerCookie);
    expect(malformed.status).toBe(404);
  });

  it("PUT /products/:id/course sets + clears the product's default course; bad body → 400; a bad/retired course → 404; a malformed product is a no-op", async () => {
    const courseId = await createCourse(unique("Course"));
    const { productId } = await withTransaction(suite.db, async (tx) => {
      const catalogue = await createCatalogue(tx, {
        name: unique("Carta"),
      });
      const category = await createCategory(tx, {
        name: { [LOCALE]: unique("Cat") },
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
    // A malformed PRODUCT id gets the verb's unknown-id no-op, a 204.
    expect((await put({ courseId }, "not-a-uuid")).status).toBe(204);
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
