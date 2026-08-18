import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountManagementApi } from "./management-api.js";
import { startRealPostgres } from "./testing/postgres.js";

// Real Postgres, not PGlite: these routes wrap the service-status config CRUD, and each verb both
// AUTHORIZES (`authorizeManager` reads persons + management_sessions under the app role's RLS) and
// writes `table_service_statuses` under FORCE ROW LEVEL SECURITY — both false passes on PGlite's
// superuser connection (CLAUDE.md §4). The same real-Postgres justification as `management-api.rls.test.ts`,
// whose harness (`applyVenue`/`planVenue` + password `login`) this file reuses.
const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // ≥ MIN_PASSWORD_LENGTH; the manager's & staff's seeded password.

const suite = useRealPostgres({
  start: startRealPostgres,
  timeoutMs: 180_000,
});

/** A no-op logger: only the HTTP responses and the database state matter here. */
const noopLog: Logger = () => {};

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so the provisioned venue needs its own NIF — the same per-suite counter the sibling suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(72_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** A label unique within the shared tenant, so tests are order-independent (CLAUDE.md §4) — the status
 *  set accumulates across tests, and `(tenant, label)` is unique, so a fixed label would collide. */
function uniqueLabel(base: string): string {
  return `${base}-${randomUUID().slice(0, 8)}`;
}

/**
 * Stand up a fresh provisioned venue (as the owner), then seed — as the app role under the tenant, so
 * RLS is exercised — a MANAGER (role `manager`, which holds `till.configure`) and a STAFF person (role
 * `staff`, which holds nothing), each WITH a dashboard password so both can log in. Provisioning
 * creates only the ADMIN, so these two are seeded directly; `pin_hash` is NOT NULL, so a value is
 * supplied even though they log in by password.
 */
async function setupTenant(): Promise<{ tenantId: string; managerId: string; staffId: string }> {
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
  return { tenantId: venue.tenantId, managerId, staffId };
}

function mountApp(tenantId: string): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.admin,
      cfg: { tenantId },
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

// One provisioned tenant + a manager and a staff cookie, shared across the tests. Each test uses a
// UNIQUE label so the accumulating status set never collides (CLAUDE.md §4) and every list assertion is
// a membership check, never an exact-list one.
let app: Hono;
let managerCookie: string;
let staffCookie: string;
const json = { "content-type": "application/json" };

beforeAll(async () => {
  const { tenantId, managerId, staffId } = await setupTenant();
  app = mountApp(tenantId);
  managerCookie = await login(app, managerId);
  staffCookie = await login(app, staffId);
});

/** POST/GET/PATCH/DELETE a `/management-api/service-statuses[...]` path with the given cookie. */
async function request(path: string, init: RequestInit, cookie?: string): Promise<Response> {
  return app.request(`/management-api/service-statuses${path}`, {
    ...init,
    headers: { ...json, ...(cookie ? { cookie } : {}), ...init.headers },
  });
}

describe("/management-api/service-statuses", () => {
  it("POST creates (201 { id }) + GET lists it (manager)", async () => {
    const label = uniqueLabel("Bill requested");
    const create = await request(
      "",
      { method: "POST", body: JSON.stringify({ label, color: "#ef4444", displayOrder: 0 }) },
      managerCookie,
    );
    // 201 Created, matching every other management-surface create (createPerson/staff, catalogues).
    expect(create.status).toBe(201);
    const { id } = (await create.json()) as { id: string };
    expect(id).toBeDefined();

    const list = (await (await request("", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      label: string;
      active: boolean;
    }[];
    expect(list.find((s) => s.id === id)).toMatchObject({ label, active: true });
  });

  it("POST without displayOrder defaults it to 0", async () => {
    const label = uniqueLabel("Needs cleaning");
    const create = await request(
      "",
      { method: "POST", body: JSON.stringify({ label, color: "amber-500" }) },
      managerCookie,
    );
    expect(create.status).toBe(201);
    const { id } = (await create.json()) as { id: string };
    const list = (await (await request("", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      displayOrder: number;
    }[];
    expect(list.find((s) => s.id === id)).toMatchObject({ displayOrder: 0 });
  });

  it("POST with a duplicate label → 409 status.label_taken", async () => {
    const label = uniqueLabel("Reserved");
    await request(
      "",
      { method: "POST", body: JSON.stringify({ label, color: "#3b82f6" }) },
      managerCookie,
    );
    const dup = await request(
      "",
      { method: "POST", body: JSON.stringify({ label, color: "#000" }) },
      managerCookie,
    );
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: { code: "status.label_taken" } });
  });

  it("POST with a bad color → 400 management.request_invalid (naming the field)", async () => {
    const res = await request(
      "",
      {
        method: "POST",
        body: JSON.stringify({ label: uniqueLabel("Bad"), color: "red; drop table x" }),
      },
      managerCookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "color" } },
    });
  });

  it("POST body screens: a null body, a missing/non-string label/color, a non-integer displayOrder → 400", async () => {
    // null body → coerced to {} then the label screen fires (field "body" only fires for a non-object
    // truthy body such as an array).
    const nullBody = await request("", { method: "POST", body: "null" }, managerCookie);
    expect(nullBody.status).toBe(400);
    expect(await nullBody.json()).toMatchObject({ error: { code: "management.request_invalid" } });

    // A JSON array is a non-object body → field "body".
    const arrayBody = await request("", { method: "POST", body: "[]" }, managerCookie);
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });

    const noLabel = await request(
      "",
      { method: "POST", body: JSON.stringify({ color: "#000" }) },
      managerCookie,
    );
    expect(noLabel.status).toBe(400);
    expect(await noLabel.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "label" } },
    });

    const noColor = await request(
      "",
      { method: "POST", body: JSON.stringify({ label: uniqueLabel("X") }) },
      managerCookie,
    );
    expect(noColor.status).toBe(400);
    expect(await noColor.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "color" } },
    });

    const badOrder = await request(
      "",
      {
        method: "POST",
        body: JSON.stringify({ label: uniqueLabel("Y"), color: "#000", displayOrder: 1.5 }),
      },
      managerCookie,
    );
    expect(badOrder.status).toBe(400);
    expect(await badOrder.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "displayOrder" } },
    });
  });

  it("PATCH edits label/color/displayOrder/active (204), then GET reflects it", async () => {
    const { id } = (await (
      await request(
        "",
        {
          method: "POST",
          body: JSON.stringify({ label: uniqueLabel("Occupied"), color: "#f97316" }),
        },
        managerCookie,
      )
    ).json()) as { id: string };

    const newLabel = uniqueLabel("Occupied-edited");
    const patch = await request(
      `/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ label: newLabel, color: "#22c55e", displayOrder: 5, active: false }),
      },
      managerCookie,
    );
    expect(patch.status).toBe(204);
    expect(await patch.text()).toBe("");

    const list = (await (await request("", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      label: string;
      color: string;
      displayOrder: number;
      active: boolean;
    }[];
    expect(list.find((s) => s.id === id)).toMatchObject({
      label: newLabel,
      color: "#22c55e",
      displayOrder: 5,
      active: false,
    });
  });

  it("PATCH an unknown id → 404 status.not_found; a malformed :id → 404 too (isUuid guard)", async () => {
    const unknown = await request(
      "/00000000-0000-4000-8000-000000000000",
      { method: "PATCH", body: JSON.stringify({ label: uniqueLabel("X") }) },
      managerCookie,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "status.not_found" } });

    // Dropping the `if (!isUuid(id))` line makes this a 500 (raw `22P02`) instead of 404 — the
    // prove-by-deletion for the `:id` guard.
    const malformed = await request(
      "/not-a-uuid",
      { method: "PATCH", body: JSON.stringify({ label: uniqueLabel("X") }) },
      managerCookie,
    );
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({ error: { code: "status.not_found" } });
  });

  it("PATCH body screens: an array body → 400 (field body); non-string label/color, non-integer displayOrder, non-boolean active → 400", async () => {
    const id = randomUUID(); // a well-formed uuid, so the isUuid screen passes and the body screens fire

    // A JSON array is a non-object body → field "body".
    const arrayBody = await request(`/${id}`, { method: "PATCH", body: "[]" }, managerCookie);
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });

    const badLabel = await request(
      `/${id}`,
      { method: "PATCH", body: JSON.stringify({ label: 123 }) },
      managerCookie,
    );
    expect(badLabel.status).toBe(400);
    expect(await badLabel.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "label" } },
    });

    const badColor = await request(
      `/${id}`,
      { method: "PATCH", body: JSON.stringify({ color: 123 }) },
      managerCookie,
    );
    expect(badColor.status).toBe(400);
    expect(await badColor.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "color" } },
    });

    const badOrder = await request(
      `/${id}`,
      { method: "PATCH", body: JSON.stringify({ displayOrder: "x" }) },
      managerCookie,
    );
    expect(badOrder.status).toBe(400);
    expect(await badOrder.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "displayOrder" } },
    });

    const badActive = await request(
      `/${id}`,
      { method: "PATCH", body: JSON.stringify({ active: "yes" }) },
      managerCookie,
    );
    expect(badActive.status).toBe(400);
    expect(await badActive.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "active" } },
    });
  });

  it("PATCH with a null / empty body → 204 no-op (never a 500), the status unchanged", async () => {
    // A `null` body coerces to `{}` (`?? {}`) and carries no mutable field: the route answers a 204
    // no-op WITHOUT reaching updateStatus's empty `.set()` (which Drizzle rejects → a 500). Mirrors the
    // staff PATCH route's "null body → 204 no-op" (management-api.rls.test.ts).
    const { id } = (await (
      await request(
        "",
        {
          method: "POST",
          body: JSON.stringify({
            label: uniqueLabel("Unchanged"),
            color: "#123456",
            displayOrder: 3,
          }),
        },
        managerCookie,
      )
    ).json()) as { id: string };

    const nullBody = await request(`/${id}`, { method: "PATCH", body: "null" }, managerCookie);
    expect(nullBody.status).toBe(204);
    expect(await nullBody.text()).toBe("");

    const emptyBody = await request(`/${id}`, { method: "PATCH", body: "{}" }, managerCookie);
    expect(emptyBody.status).toBe(204);

    // The status is untouched by either no-op.
    const list = (await (await request("", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      color: string;
      displayOrder: number;
      active: boolean;
    }[];
    expect(list.find((s) => s.id === id)).toMatchObject({
      color: "#123456",
      displayOrder: 3,
      active: true,
    });
  });

  it("DELETE deactivates a status (204), then GET shows it inactive", async () => {
    const { id } = (await (
      await request(
        "",
        { method: "POST", body: JSON.stringify({ label: uniqueLabel("ToRetire"), color: "#000" }) },
        managerCookie,
      )
    ).json()) as { id: string };

    const del = await request(`/${id}`, { method: "DELETE" }, managerCookie);
    expect(del.status).toBe(204);
    expect(await del.text()).toBe("");

    const list = (await (await request("", { method: "GET" }, managerCookie)).json()) as {
      id: string;
      active: boolean;
    }[];
    expect(list.find((s) => s.id === id)).toMatchObject({ active: false });
  });

  it("DELETE an unknown id → 404 status.not_found; a malformed :id → 404 too (isUuid guard)", async () => {
    const unknown = await request(
      "/00000000-0000-4000-8000-000000000000",
      { method: "DELETE" },
      managerCookie,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "status.not_found" } });

    const malformed = await request("/not-a-uuid", { method: "DELETE" }, managerCookie);
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({ error: { code: "status.not_found" } });
  });

  it("a STAFF session is refused on every route (403 authorization.not_permitted)", async () => {
    // A staff person CAN log in but holds no `till.configure`, so each verb's `authorizeManager`
    // refuses it 403 — after the route's session guard + body/id screens, before any write. Deleting
    // the authorize call from a verb flips its case to a 2xx (proven by deletion in
    // `service-statuses.rls.test.ts`); here the same 403 is exercised end-to-end over HTTP.
    const someId = randomUUID();
    const cases = [
      request(
        "",
        { method: "POST", body: JSON.stringify({ label: uniqueLabel("Nope"), color: "#000" }) },
        staffCookie,
      ),
      request("", { method: "GET" }, staffCookie),
      request(
        `/${someId}`,
        { method: "PATCH", body: JSON.stringify({ label: uniqueLabel("Z") }) },
        staffCookie,
      ),
      request(`/${someId}`, { method: "DELETE" }, staffCookie),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    }
  });

  it("no session → 401 management_session.required on every route", async () => {
    // `requireManagementSession` runs FIRST on each route, so an unauthenticated request is refused
    // before any DB work — the deletion proof for the route-level session gate.
    const someId = randomUUID();
    const cases = [
      request(
        "",
        { method: "POST", body: JSON.stringify({ label: "Nope", color: "#000" }) },
        undefined,
      ),
      request("", { method: "GET" }, undefined),
      request(`/${someId}`, { method: "PATCH", body: JSON.stringify({ label: "Z" }) }, undefined),
      request(`/${someId}`, { method: "DELETE" }, undefined),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "management_session.required" } });
    }
  });
});
