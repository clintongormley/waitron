import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { DEFAULT_PROFILES } from "@waitron/layouts";
import type { ProfileDef, ThemeOverride } from "@waitron/layouts";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountManagementApi } from "./management-api.js";

// Real Postgres, not PGlite: these routes wrap the layout-profile CRUD + tenant-theme config, and each
// verb both AUTHORIZES (`authorizeManager` reads persons + management_sessions under the app role's
// RLS) and reads/writes `layout_profiles` / `tenant_themes` under FORCE ROW LEVEL SECURITY — both
// false passes on PGlite's superuser connection (CLAUDE.md §4). The same real-Postgres justification
// as `management-api.rls.test.ts`, whose harness (`applyVenue`/`planVenue` + password `login`) this
// file reuses.
const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // ≥ MIN_PASSWORD_LENGTH; the manager's & staff's seeded password.
const MANAGER_EMAIL = "manager@x.com";
const STAFF_EMAIL = "clerk@x.com";

const suite = useTemplateDb({ template: "manifest" });

/** A no-op logger: only the HTTP responses and the database state matter here. */
const noopLog: Logger = () => {};

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — a distinct per-suite base from the sibling suites.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(74_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** A profile name unique within the shared tenant, so tests are order-independent (CLAUDE.md §4) — the
 *  profile set accumulates per tenant and `(tenant, name)` is unique, so a fixed name could collide. */
function uniqueName(base: string): string {
  return `${base}-${randomUUID().slice(0, 8)}`;
}

/** A valid phone profile with a distinguishing title, so a stored row is never mistaken for a default
 *  and two round-trips can be told apart. Mirrors `profile-store.rls.test.ts`'s helper. */
function phoneProfile(title: string): ProfileDef {
  const base = DEFAULT_PROFILES["phone-portrait"];
  return { ...base, tabs: [{ ...base.tabs[0]!, title }, ...base.tabs.slice(1)] };
}

/**
 * Stand up a fresh provisioned venue (as the owner), then seed — as the app role under the tenant, so
 * RLS is exercised — a MANAGER (role `manager`, holds `till.configure`) and a STAFF person (role
 * `staff`, holds nothing), each WITH a dashboard password so both can log in. Provisioning creates
 * only the ADMIN, so these two are seeded directly; `pin_hash` is NOT NULL so a value is supplied.
 */
async function setupTenant(): Promise<{ tenantId: string }> {
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

  await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    await tx.execute(sql`
      insert into persons (tenant_id, display_name, email, pin_hash, password_hash, role)
      values (current_tenant_id(), 'The Manager', ${MANAGER_EMAIL}, ${hashPin("1234")}, ${hashPassword(PASSWORD)}, 'manager')`);
    await tx.execute(sql`
      insert into persons (tenant_id, display_name, email, pin_hash, password_hash, role)
      values (current_tenant_id(), 'The Clerk', ${STAFF_EMAIL}, ${hashPin("1234")}, ${hashPassword(PASSWORD)}, 'staff')`);
  });
  return { tenantId: venue.tenantId };
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

/** Log in over HTTP by `email`, returning the `waitron_management_session=…` cookie pair. */
async function login(app: Hono, email: string): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

const JSON_HEADERS = { "content-type": "application/json" };

describe("Management API — layout-profile CRUD (Task 11)", () => {
  let tenantId: string;
  let managerCookie: string;

  beforeAll(async () => {
    ({ tenantId } = await setupTenant());
    managerCookie = await login(mountApp(tenantId), MANAGER_EMAIL);
  });

  it("round-trips create → list → get → update → delete", async () => {
    const app = mountApp(tenantId);
    const name = uniqueName("Front counter");
    const definition = phoneProfile("Floor A");

    // CREATE → 201 { id }
    const created = await app.request("/management-api/profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name, definition }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(typeof id).toBe("string");

    // GET by id → the stored profile
    const got = await app.request(`/management-api/profiles/${id}`, {
      headers: { cookie: managerCookie },
    });
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual({ id, name, definition });

    // LIST includes it
    const listed = await app.request("/management-api/profiles", {
      headers: { cookie: managerCookie },
    });
    expect(listed.status).toBe(200);
    const { profiles } = (await listed.json()) as {
      profiles: { id: string; name: string; definition: ProfileDef }[];
    };
    expect(profiles.some((p) => p.id === id && p.name === name)).toBe(true);

    // UPDATE → 204, then GET reads back the new name + definition
    const renamed = uniqueName("Renamed");
    const nextDef = phoneProfile("Floor B");
    const updated = await app.request(`/management-api/profiles/${id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: renamed, definition: nextDef }),
    });
    expect(updated.status).toBe(204);
    expect(await updated.text()).toBe("");
    const afterUpdate = await app.request(`/management-api/profiles/${id}`, {
      headers: { cookie: managerCookie },
    });
    expect(await afterUpdate.json()).toEqual({ id, name: renamed, definition: nextDef });

    // DELETE → 204, then GET → 404 profile.not_found
    const removed = await app.request(`/management-api/profiles/${id}`, {
      method: "DELETE",
      headers: { cookie: managerCookie },
    });
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe("");
    const afterDelete = await app.request(`/management-api/profiles/${id}`, {
      headers: { cookie: managerCookie },
    });
    expect(afterDelete.status).toBe(404);
    expect((await afterDelete.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "profile.not_found" },
    });
  });

  it("GET by an unknown (well-formed) id → 404 profile.not_found", async () => {
    const app = mountApp(tenantId);
    const res = await app.request(`/management-api/profiles/${randomUUID()}`, {
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "profile.not_found" },
    });
  });

  it("GET by a MALFORMED id → 404 profile.not_found (the requireProfileId screen)", async () => {
    const app = mountApp(tenantId);
    const res = await app.request("/management-api/profiles/not-a-uuid", {
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "profile.not_found" },
    });
  });

  it("POST with an invalid definition → 400 profile.invalid", async () => {
    const app = mountApp(tenantId);
    // `{}` has no formFactor — validateProfile refuses it (profile.invalid) after authorize.
    const res = await app.request("/management-api/profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: uniqueName("Bad"), definition: {} }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "profile.invalid" },
    });
  });

  it("POST with a body missing name / definition → 400 management.request_invalid naming the field", async () => {
    const app = mountApp(tenantId);
    const noName = await app.request("/management-api/profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ definition: phoneProfile("x") }),
    });
    expect(noName.status).toBe(400);
    expect(
      (await noName.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "name" } },
    });

    const noDef = await app.request("/management-api/profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: uniqueName("NoDef") }),
    });
    expect(noDef.status).toBe(400);
    expect(
      (await noDef.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "definition" } },
    });

    // A bare JSON array (not an object) → the body-shape screen.
    const arrayBody = await app.request("/management-api/profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify([1, 2, 3]),
    });
    expect(arrayBody.status).toBe(400);
    expect((await arrayBody.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("PUT with a malformed body → 400 management.request_invalid naming the field", async () => {
    const app = mountApp(tenantId);
    // A real profile to target, so the body screen — not a not-found — is what fires.
    const created = await app.request("/management-api/profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: uniqueName("Editable"), definition: phoneProfile("E") }),
    });
    const { id } = (await created.json()) as { id: string };

    // A bare JSON array (not an object) → the body-shape screen.
    const arrayBody = await app.request(`/management-api/profiles/${id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify([1, 2, 3]),
    });
    expect(arrayBody.status).toBe(400);
    expect(
      (await arrayBody.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "body" } } });

    // Missing name.
    const noName = await app.request(`/management-api/profiles/${id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ definition: phoneProfile("E2") }),
    });
    expect(noName.status).toBe(400);
    expect(
      (await noName.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "name" } } });

    // Missing definition.
    const noDef = await app.request(`/management-api/profiles/${id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: uniqueName("E3") }),
    });
    expect(noDef.status).toBe(400);
    expect(
      (await noDef.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "definition" } },
    });
  });

  it("POST a duplicate name → 409 profile.name_taken", async () => {
    const app = mountApp(tenantId);
    const name = uniqueName("Twin");
    const first = await app.request("/management-api/profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name, definition: phoneProfile("First") }),
    });
    expect(first.status).toBe(201);

    const second = await app.request("/management-api/profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name, definition: phoneProfile("Second") }),
    });
    expect(second.status).toBe(409);
    expect((await second.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "profile.name_taken" },
    });
  });

  it("refuses every profile route for a STAFF-role session with 403 (the authorizeManager gate)", async () => {
    const app = mountApp(tenantId);
    const staffCookie = await login(app, STAFF_EMAIL);
    // Seed a profile as the manager so the GET-by-id / PUT / DELETE targets exist (the 403 must fire
    // regardless — the gate runs before any read/write).
    const created = await app.request("/management-api/profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: uniqueName("Target"), definition: phoneProfile("T") }),
    });
    const { id } = (await created.json()) as { id: string };

    const cases = [
      app.request("/management-api/profiles", { headers: { cookie: staffCookie } }),
      app.request(`/management-api/profiles/${id}`, { headers: { cookie: staffCookie } }),
      app.request("/management-api/profiles", {
        method: "POST",
        headers: { ...JSON_HEADERS, cookie: staffCookie },
        body: JSON.stringify({ name: uniqueName("Nope"), definition: phoneProfile("N") }),
      }),
      app.request(`/management-api/profiles/${id}`, {
        method: "PUT",
        headers: { ...JSON_HEADERS, cookie: staffCookie },
        body: JSON.stringify({ name: uniqueName("Nope"), definition: phoneProfile("N") }),
      }),
      app.request(`/management-api/profiles/${id}`, {
        method: "DELETE",
        headers: { cookie: staffCookie },
      }),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(403);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    }
  });

  it("refuses the profile routes unauthenticated with 401", async () => {
    const app = mountApp(tenantId);
    const res = await app.request("/management-api/profiles");
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });
  });
});

describe("Management API — tenant theme (Task 11)", () => {
  let tenantId: string;
  let managerCookie: string;

  beforeAll(async () => {
    ({ tenantId } = await setupTenant());
    managerCookie = await login(mountApp(tenantId), MANAGER_EMAIL);
  });

  it("GET returns { theme: null } for a tenant that has never authored a theme", async () => {
    const app = mountApp(tenantId);
    const res = await app.request("/management-api/theme", { headers: { cookie: managerCookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ theme: null });
  });

  it("PUT → 204, then GET reads the theme back (round-trip)", async () => {
    const app = mountApp(tenantId);
    const theme: ThemeOverride = { tokens: { "--wt-color-primary": "#ff0000" } };
    const put = await app.request("/management-api/theme", {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ theme }),
    });
    expect(put.status).toBe(204);
    expect(await put.text()).toBe("");

    const got = await app.request("/management-api/theme", { headers: { cookie: managerCookie } });
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual({ theme });
  });

  it("PUT with an unknown token → 400 theme.invalid", async () => {
    const app = mountApp(tenantId);
    const res = await app.request("/management-api/theme", {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ theme: { tokens: { "--evil": "red" } } }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "theme.invalid" },
    });
  });

  it("PUT with a body omitting theme → 400 management.request_invalid naming the field", async () => {
    const app = mountApp(tenantId);
    const empty = await app.request("/management-api/theme", {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({}),
    });
    expect(empty.status).toBe(400);
    expect(
      (await empty.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "theme" } },
    });

    // A JSON null body → readJsonBody coerces to {} → same field screen (not a TypeError → 500).
    const nul = await app.request("/management-api/theme", {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: "null",
    });
    expect(nul.status).toBe(400);
    expect((await nul.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("refuses the theme routes for a STAFF-role session with 403 (the authorizeManager gate)", async () => {
    const app = mountApp(tenantId);
    const staffCookie = await login(app, STAFF_EMAIL);
    const cases = [
      app.request("/management-api/theme", { headers: { cookie: staffCookie } }),
      app.request("/management-api/theme", {
        method: "PUT",
        headers: { ...JSON_HEADERS, cookie: staffCookie },
        body: JSON.stringify({ theme: { tokens: { "--wt-color-primary": "#000000" } } }),
      }),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(403);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    }
  });

  it("refuses the theme routes unauthenticated with 401", async () => {
    const app = mountApp(tenantId);
    const res = await app.request("/management-api/theme");
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });
  });
});
