// Real PostgreSQL exercises configuration and authorization queries after SET ROLE app_user.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";

// Exercise service-status configuration and manager authorization on PostgreSQL.
const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // ≥ MIN_PASSWORD_LENGTH; the manager's & staff's seeded password.
// Dashboard sign-in resolves the person by EMAIL, so each seeded person carries a login email
// (per-tenant unique — persons_tenant_email_uq).
const MANAGER_EMAIL = "manager@x.com";
const STAFF_EMAIL = "clerk@x.com";

const suite = useTemplateDb({ template: "manifest" });

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

/** Provision a venue as owner and seed the people and sessions this route fixture needs. */
async function setupTenant(): Promise<{ tenantId: string; managerId: string; staffId: string }> {
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
        },
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
  );

  const { managerId, staffId } = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    const manager = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, email, pin_hash, password_hash, role)
      values (${venue.tenantId}, 'The Manager', ${MANAGER_EMAIL}, ${hashPin("1234")}, ${hashPassword(PASSWORD)}, 'manager')
      returning id`);
    const staff = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, email, pin_hash, password_hash, role)
      values (${venue.tenantId}, 'The Clerk', ${STAFF_EMAIL}, ${hashPin("1234")}, ${hashPassword(PASSWORD)}, 'staff')
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
      // The all-zero node id (the capture default): this suite exercises the staff-status routes, not
      // origin attribution, so the sentinel keeps its enrolled writes' origin exactly as before Task 6.
      cfg: { tenantId, nodeId: "00000000-0000-0000-0000-000000000000" },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
    },
    noopLog,
  );
  return app;
}

/** Log in over HTTP by `email`, returning just the `waitron_management_session=…` cookie pair. */
async function login(app: Hono, email: string): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
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
  const { tenantId } = await setupTenant();
  app = mountApp(tenantId);
  managerCookie = await login(app, MANAGER_EMAIL);
  staffCookie = await login(app, STAFF_EMAIL);
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

  it("POST body screens: a null body, a missing/non-string label/color, a non-integer OR non-number displayOrder → 400", async () => {
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

    // A NON-NUMBER displayOrder (here `null`) is rejected, not coerced: a bare `Number(null)` is 0, so
    // the pre-fix `Number` + `Number.isInteger` check silently accepted it (→ displayOrder 0). The
    // typeof-first screen refuses it — the prove-by-behaviour for the `parseDisplayOrder` type check.
    const nullOrder = await request(
      "",
      {
        method: "POST",
        body: JSON.stringify({ label: uniqueLabel("Z"), color: "#000", displayOrder: null }),
      },
      managerCookie,
    );
    expect(nullOrder.status).toBe(400);
    expect(await nullOrder.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "displayOrder" } },
    });

    // An integer OUTSIDE int4 range clears `Number.isInteger` but would overflow the Postgres `integer`
    // column and raise 22003 — an opaque 500 — without the range bound. The screen refuses it with a
    // clean 400 (prove-by-behaviour for the int4-range half of `parseDisplayOrder`; delete the range
    // check and this reverts to a 500).
    const hugeOrder = await request(
      "",
      {
        method: "POST",
        body: JSON.stringify({
          label: uniqueLabel("W"),
          color: "#000",
          displayOrder: 2_147_483_648,
        }),
      },
      managerCookie,
    );
    expect(hugeOrder.status).toBe(400);
    expect(await hugeOrder.json()).toMatchObject({
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

  it("PATCH body screens: an array body → 400 (field body); non-string label/color, non-integer OR non-number displayOrder, non-boolean active → 400", async () => {
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

    // A NON-NUMBER displayOrder (here `null`) is rejected, not coerced — an explicit `null` on PATCH
    // would otherwise have reset displayOrder to 0 (`Number(null)` → 0). See the POST screen above.
    const nullOrder = await request(
      `/${id}`,
      { method: "PATCH", body: JSON.stringify({ displayOrder: null }) },
      managerCookie,
    );
    expect(nullOrder.status).toBe(400);
    expect(await nullOrder.json()).toMatchObject({
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
    // staff PATCH route's "null body → 204 no-op" (management-api.pg.test.ts).
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
    // `service-statuses.test.ts`); here the same 403 is exercised end-to-end over HTTP.
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
