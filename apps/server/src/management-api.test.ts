import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Logger } from "./logger.js";
import type { TillConfig } from "./till-config.js";
import { mountManagementApi } from "./management-api.js";

// Real Postgres, not PGlite: these routes wrap the floor-zone + table config CRUD, and each route both
// AUTHORIZES (`authorizeManager` reads persons + management_sessions under the app role's RLS) and
// writes `floor_zones` / `dining_tables` under FORCE ROW LEVEL SECURITY — both false passes on PGlite's
// superuser connection (CLAUDE.md §4). The same real-Postgres justification as `management-api.status.test.ts`,
// whose harness (`applyVenue`/`planVenue` + password `login`) this file reuses.
const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // ≥ MIN_PASSWORD_LENGTH; the manager's & staff's seeded password.

const suite = useTemplateDb({ template: "manifest" });

/** A no-op logger: only the HTTP responses and the database state matter here. */
const noopLog: Logger = () => {};

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the same per-suite counter the sibling suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(74_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** A name/label unique within the shared tenant+location, so tests are order-independent (CLAUDE.md §4):
 *  the zone/table set accumulates across tests and `(tenant, location, name|label)` is unique, so a fixed
 *  value would collide. Every list assertion is therefore a membership check, never an exact-list one. */
function unique(base: string): string {
  return `${base}-${randomUUID().slice(0, 8)}`;
}

/**
 * Stand up a fresh provisioned venue (as the owner), then seed — as the app role under the tenant, so
 * RLS is exercised — a MANAGER (role `manager`, which holds `till.configure`) and a STAFF person (role
 * `staff`, which holds nothing), each WITH a dashboard password so both can log in. Provisioning creates
 * only the ADMIN, so these two are seeded directly; `pin_hash` is NOT NULL, so a value is supplied even
 * though they log in by password. Returns the whole `VenueResult` so `mountApp` can thread the venue's
 * location into the zone/table config routes.
 */
async function setupTenant(): Promise<{ venue: VenueResult; managerId: string; staffId: string }> {
  const venue = await applyVenue(
    planVenue({
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
      },
    }),
    { db: suite.admin },
  );

  const { managerId, staffId } = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    const manager = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, password_hash, role)
      values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, ${hashPassword(PASSWORD)}, 'manager')
      returning id`);
    const staff = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, password_hash, role)
      values (current_tenant_id(), 'The Clerk', ${hashPin("1234")}, ${hashPassword(PASSWORD)}, 'staff')
      returning id`);
    return { managerId: manager.rows[0]!.id, staffId: staff.rows[0]!.id };
  });
  return { venue, managerId, staffId };
}

/** Build the venue's `TillConfig` from an `applyVenue` result — the tenant + location the zone/table
 *  config verbs scope to (the other fiscal ids are inert on the config surface). Mirrors the same
 *  helper in `move-merge.rls.test.ts`; `boot.ts` threads the real `till` config here in production. */
function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    tenantId: brandTenantId(venue.tenantId),
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

function mountApp(venue: VenueResult): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.admin,
      cfg: { tenantId: venue.tenantId },
      // The venue's own config (tenant + location) the zone/table config routes scope to.
      venueCfg: tillConfigFromVenue(venue),
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
    },
    noopLog,
  );
  return app;
}

/** Log in over HTTP as `personId`, returning just the `waitron_management_session=…` cookie pair. */
async function login(app: Hono, personId: string): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ personId, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

// One provisioned tenant + a manager and a staff cookie, shared across the tests. Each test uses UNIQUE
// zone/table names so the accumulating sets never collide (CLAUDE.md §4). `venue` is kept at module
// scope too so the placement tests can read `dining_tables` back directly under its tenant (see
// `readPlacement`).
let app: Hono;
let venue: VenueResult;
let managerCookie: string;
let staffCookie: string;
const json = { "content-type": "application/json" };

beforeAll(async () => {
  const setup = await setupTenant();
  venue = setup.venue;
  app = mountApp(venue);
  managerCookie = await login(app, setup.managerId);
  staffCookie = await login(app, setup.staffId);
});

/** Request a `/management-api<path>` route with the given cookie. */
async function req(path: string, init: RequestInit, cookie?: string): Promise<Response> {
  return app.request(`/management-api${path}`, {
    ...init,
    headers: { ...json, ...(cookie ? { cookie } : {}), ...init.headers },
  });
}

/** Create a zone as the manager and return its id — a helper for the table tests that assign one. */
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

    // Dropping the `if (!isUuid(id))` line makes this a 500 (raw `22P02`) instead of 404.
    const malformed = await req(
      "/zones/not-a-uuid",
      { method: "PATCH", body: JSON.stringify({ name: unique("X") }) },
      managerCookie,
    );
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({ error: { code: "zone.not_found" } });
  });

  it("PATCH body screens: array → body; non-string name; bad displayOrder; non-boolean active", async () => {
    const id = randomUUID(); // well-formed uuid, so the isUuid screen passes and the body screens fire

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

    // listZones returns only ACTIVE zones, so a deactivated one drops out entirely.
    const afterDel = (await (await req("/zones", { method: "GET" }, managerCookie)).json()) as {
      id: string;
    }[];
    expect(afterDel.find((z) => z.id === id)).toBeUndefined();

    // Reactivating via PATCH proves it was a soft-delete, not a hard delete.
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
    // A staff person CAN log in but holds no `till.configure`, so each route's `authorizeManager`
    // refuses it 403 — after the session guard + body/id screens, before any write. Dropping the
    // authorize call from a route flips its case to a 2xx (the gate deletion-proof).
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

  it("a manager cannot see another tenant's zones (cross-tenant isolation)", async () => {
    const other = await setupTenant();
    const otherApp = mountApp(other.venue);
    const otherManager = await login(otherApp, other.managerId);

    const mine = unique("MineOnly");
    const id = await createZone(mine);

    const theirs = (await (
      await otherApp.request("/management-api/zones", { headers: { cookie: otherManager } })
    ).json()) as { id: string; name: string }[];
    expect(theirs.find((z) => z.id === id)).toBeUndefined();
    expect(theirs.find((z) => z.name === mine)).toBeUndefined();
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
    // Route-level place-then-read receipt for the Task-7b gap: the config GET /tables surface now
    // projects the four placement columns (listTables), so the Plano editor sees a placed table as
    // placed on reload instead of snapping it back to the unplaced tray. Proven by the POSITIVE read
    // of real values, not merely that nulls pass (CLAUDE.md §1).
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

  it("POST with a MALFORMED zoneId → 404 zone.not_found (isUuid guard, not an opaque 22P02 500)", async () => {
    // A present, string-typed but non-UUID `zoneId` passes the `typeof` screen (that catches only the
    // WRONG-TYPE case, e.g. `123`), so without the `isUuid` screen it reaches the `zone_id` uuid column and
    // PostgreSQL raises `22P02` → an opaque `server.internal` 500. It is screened to the SAME
    // `zone.not_found` a well-formed-but-missing zoneId gets (test above) — the prove-by-deletion.
    const res = await req(
      "/tables",
      { method: "POST", body: JSON.stringify({ label: unique("z"), zoneId: "not-a-uuid" }) },
      managerCookie,
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "zone.not_found" } });
  });

  it("POST body screens: null → field label, array → field body, non-string label/zoneId, bad capacity", async () => {
    // A `null` body coerces to `{}` (`?? {}`), then the label screen fires (field "body" is only for a
    // non-object truthy body such as an array) — the same null-body discipline the sibling routes follow.
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

  it("PATCH with a MALFORMED zoneId → 404 zone.not_found (isUuid guard, not an opaque 22P02 500)", async () => {
    // The twin of the POST screen above: a present, string-typed but non-UUID `zoneId` in the patch is
    // screened to `zone.not_found` (→ 404) BEFORE `updateTable`, the SAME code a well-formed-but-missing
    // zoneId gets. Without the screen the string reaches the `zone_id` uuid column → `22P02` → opaque 500.
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
    const id = randomUUID(); // well-formed uuid, so the isUuid screen passes and the body screens fire

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

    // A null / empty body carries no mutable field → a 204 no-op (never Drizzle's "No values to set" 500).
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

// ── FP-2 spatial placement (dashboard) ──────────────────────────────────────────────────────────────
// The manager-gated PUT/DELETE that place a table on / remove it from the floor-plan canvas, thin
// wrappers over Task 2's `setTablePlacement` / `clearPlacement`. Same gate + `run` mapping as the FP-1
// zone/table routes above (`requireManagementSession` 401 first, then `withVenueAuth`'s
// `authorizeManager(till.configure)` 403). These placement tests read the row back with a DIRECT
// `dining_tables` read (`readPlacement`) — a tight row-level receipt for exactly the four columns the
// PUT/DELETE write. The management `GET /tables` surface (`listTables`) DOES now project those columns
// (Task 7b), verified end-to-end by the "GET projects a placed table's placement columns" case in the
// `/management-api/tables` describe above; the direct read here keeps this describe focused on the verb.

/** The canonical placement body — the exact values the brief pins. `zoneId` varies per test (each needs
 *  its own LIVE zone), so it is a parameter. */
function place(zoneId: string): {
  zoneId: string;
  posX: number;
  posY: number;
  shape: string;
  rotation: number;
} {
  return { zoneId, posX: 500, posY: 250, shape: "square", rotation: 0 };
}

/** Read a table's four placement columns as the app role under the venue's tenant (RLS-scoped). */
async function readPlacement(tableId: string): Promise<{
  posX: number | null;
  posY: number | null;
  shape: string | null;
  rotation: number | null;
}> {
  return withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
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
  /** A fresh ACTIVE table + ACTIVE zone — `setTablePlacement` requires BOTH live. */
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

    // No session → 401 before any DB work.
    const unauth = await req(`/tables/${tableId}/placement`, {
      method: "PUT",
      body: JSON.stringify(place(zoneId)),
    });
    expect(unauth.status).toBe(401);
    expect(await unauth.json()).toMatchObject({ error: { code: "management_session.required" } });

    // A staff session CAN log in but holds no `till.configure`, so `authorizeManager` (inside
    // `withVenueAuth`) refuses it 403 — the gate deletion-proof: dropping that authorize call flips
    // this case to 204.
    const staff = await req(
      `/tables/${tableId}/placement`,
      { method: "PUT", body: JSON.stringify(place(zoneId)) },
      staffCookie,
    );
    expect(staff.status).toBe(403);
    expect(await staff.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    // The refused staff attempt wrote nothing.
    expect(await readPlacement(tableId)).toMatchObject({ posX: null, posY: null, shape: null });

    // A manager places it → 204, and the placement lands on the row.
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
    // Place it first (manager), so DELETE has something to clear.
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
    // The refused staff attempt did not clear it.
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

    // Malformed :id → requireTableId throws table.not_found at the route (else 22P02 → opaque 500).
    const malformed = await req(
      "/tables/not-a-uuid/placement",
      { method: "PUT", body: JSON.stringify(place(zoneId)) },
      managerCookie,
    );
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({ error: { code: "table.not_found" } });

    // Well-formed but unknown id → the verb's active-table read finds nothing → table.not_found.
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

    // A present, string-typed but non-UUID zoneId is screened to zone.not_found at the route (else it
    // reaches the `id` uuid column → 22P02 → opaque 500), the sibling table-route shape.
    const malformed = await req(
      `/tables/${tableId}/placement`,
      { method: "PUT", body: JSON.stringify({ ...place("x"), zoneId: "not-a-uuid" }) },
      managerCookie,
    );
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({ error: { code: "zone.not_found" } });
  });

  it("PUT body screens: array → body; non-string zoneId; non-number posX/posY/rotation; non-string shape", async () => {
    const id = randomUUID(); // well-formed uuid, so requireTableId passes and the body screens fire
    const base = { zoneId: randomUUID(), posX: 500, posY: 250, shape: "square", rotation: 0 };

    // A `null` body coerces to `{}` (`?? {}`), then the first field screen fires (field "body" is only
    // for a non-object TRUTHY body such as an array) — the same null-body discipline the sibling routes
    // follow.
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
