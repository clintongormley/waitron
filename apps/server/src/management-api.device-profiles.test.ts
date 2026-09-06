import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { DEFAULT_CANVASES } from "@waitron/layouts";
import type { CanvasDef } from "@waitron/layouts";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";

// Real Postgres, not PGlite: these routes wrap the device-profile CRUD store, and each verb both
// AUTHORIZES (`authorizeManager` reads persons + management_sessions as the app role) and
// reads/writes `device_profiles` as that same role — grants a PGlite superuser connection holds
// unconditionally (CLAUDE.md §4). The same real-Postgres justification and harness as the
// sibling `management-api.canvases.test.ts` (`applyVenue`/`planVenue` + password `login`).
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
  return `${String(75_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** A profile (or canvas) name unique within the shared tenant, so tests are order-independent
 *  (CLAUDE.md §4) — the profile set accumulates per tenant and `(tenant, name)` is unique, so a fixed
 *  name could collide across tests. */
function uniqueName(base: string): string {
  return `${base}-${randomUUID().slice(0, 8)}`;
}

/** A valid phone canvas with a distinguishing title, so a stored canvas seeded here to bind a profile
 *  to is never mistaken for a default. Mirrors `management-api.canvases.test.ts`'s helper. */
function phoneCanvas(title: string): CanvasDef {
  const base = DEFAULT_CANVASES["phone-portrait"];
  return { ...base, tabs: [{ ...base.tabs[0]!, title }, ...base.tabs.slice(1)] };
}

/** Provision a venue as owner and seed the people and sessions this route fixture needs. */
async function setupTenant(): Promise<{ tenantId: string }> {
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

  await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    await tx.execute(sql`
      insert into persons (tenant_id, display_name, email, pin_hash, password_hash, role)
      values (${venue.tenantId}, 'The Manager', ${MANAGER_EMAIL}, ${hashPin("1234")}, ${hashPassword(PASSWORD)}, 'manager')`);
    await tx.execute(sql`
      insert into persons (tenant_id, display_name, email, pin_hash, password_hash, role)
      values (${venue.tenantId}, 'The Clerk', ${STAFF_EMAIL}, ${hashPin("1234")}, ${hashPassword(PASSWORD)}, 'staff')`);
  });
  return { tenantId: venue.tenantId };
}

function mountApp(tenantId: string): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.admin,
      // nodeId sentinel: the device-profile management routes never read cfg.nodeId, but
      // mountManagementApi's cfg requires it (identity-config flow-down, #195). Matches the sibling
      // management tests (management-api.canvases.test.ts, …-status/-passkey).
      cfg: { tenantId, nodeId: "00000000-0000-0000-0000-000000000000" },
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

type ProfileRow = { id: string; name: string; canvasId: string | null; capabilities: string[] };

/** Seed a canvas through the management canvas route so a profile can bind to a REAL `canvasId`. */
async function seedCanvas(app: Hono, cookie: string, name: string): Promise<string> {
  const res = await app.request("/management-api/canvases", {
    method: "POST",
    headers: { ...JSON_HEADERS, cookie },
    body: JSON.stringify({ name, definition: phoneCanvas(name) }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe("Management API — device-profile CRUD (Task 4)", () => {
  let tenantId: string;
  let managerCookie: string;

  beforeAll(async () => {
    ({ tenantId } = await setupTenant());
    managerCookie = await login(mountApp(tenantId), MANAGER_EMAIL);
  });

  it("round-trips create → list → get → update → delete", async () => {
    const app = mountApp(tenantId);
    const name = uniqueName("Front counter");

    // CREATE → 201, the stored row (canvasId null, the two till capabilities).
    const created = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name,
        canvasId: null,
        capabilities: ["integrated-card-payment", "open-cash-drawer"],
      }),
    });
    expect(created.status).toBe(201);
    const row = (await created.json()) as ProfileRow;
    expect(typeof row.id).toBe("string");
    expect(row).toEqual({
      id: row.id,
      name,
      canvasId: null,
      capabilities: ["integrated-card-payment", "open-cash-drawer"],
    });
    const { id } = row;

    // GET by id → the stored row.
    const got = await app.request(`/management-api/device-profiles/${id}`, {
      headers: { cookie: managerCookie },
    });
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual({
      id,
      name,
      canvasId: null,
      capabilities: ["integrated-card-payment", "open-cash-drawer"],
    });

    // LIST includes it.
    const listed = await app.request("/management-api/device-profiles", {
      headers: { cookie: managerCookie },
    });
    expect(listed.status).toBe(200);
    const { deviceProfiles } = (await listed.json()) as { deviceProfiles: ProfileRow[] };
    expect(deviceProfiles.some((p) => p.id === id && p.name === name)).toBe(true);

    // UPDATE → 200, the new row (renamed, capabilities replaced).
    const renamed = uniqueName("Renamed");
    const updated = await app.request(`/management-api/device-profiles/${id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: renamed, canvasId: null, capabilities: ["act-as-kds"] }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({
      id,
      name: renamed,
      canvasId: null,
      capabilities: ["act-as-kds"],
    });

    // DELETE → 204, then GET → 404 device_profile.not_found.
    const removed = await app.request(`/management-api/device-profiles/${id}`, {
      method: "DELETE",
      headers: { cookie: managerCookie },
    });
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe("");
    const afterDelete = await app.request(`/management-api/device-profiles/${id}`, {
      headers: { cookie: managerCookie },
    });
    expect(afterDelete.status).toBe(404);
    expect((await afterDelete.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device_profile.not_found" },
    });
  });

  it("binds a profile to a real canvasId (create → get round-trip)", async () => {
    const app = mountApp(tenantId);
    const canvasId = await seedCanvas(app, managerCookie, uniqueName("Bound canvas"));
    const created = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: uniqueName("Bound"), canvasId, capabilities: [] }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as ProfileRow;
    const got = await app.request(`/management-api/device-profiles/${id}`, {
      headers: { cookie: managerCookie },
    });
    expect(((await got.json()) as ProfileRow).canvasId).toBe(canvasId);
  });

  it("GET by an unknown (well-formed) id → 404 device_profile.not_found", async () => {
    const app = mountApp(tenantId);
    const res = await app.request(`/management-api/device-profiles/${randomUUID()}`, {
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device_profile.not_found" },
    });
  });

  it("GET by a MALFORMED id → 404 device_profile.not_found (the requireDeviceProfileId screen)", async () => {
    const app = mountApp(tenantId);
    const res = await app.request("/management-api/device-profiles/not-a-uuid", {
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device_profile.not_found" },
    });
  });

  it("PUT to an unknown (well-formed) id → 404 device_profile.not_found (no silent no-op)", async () => {
    const app = mountApp(tenantId);
    const res = await app.request(`/management-api/device-profiles/${randomUUID()}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: uniqueName("Ghost"), canvasId: null, capabilities: [] }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device_profile.not_found" },
    });
  });

  it("DELETE an unknown (well-formed) id → 404 device_profile.not_found (no silent no-op)", async () => {
    const app = mountApp(tenantId);
    const res = await app.request(`/management-api/device-profiles/${randomUUID()}`, {
      method: "DELETE",
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device_profile.not_found" },
    });
  });

  it("POST with a canvasId that references no canvas → 400 device_profile.invalid (bad_canvas_ref)", async () => {
    const app = mountApp(tenantId);
    const res = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name: uniqueName("BadRef"),
        canvasId: randomUUID(),
        capabilities: [],
      }),
    });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { reason: string } } },
    ).toMatchObject({
      error: { code: "device_profile.invalid", params: { reason: "bad_canvas_ref" } },
    });
  });

  it("POST with an unknown capability → 400 device_profile.invalid (bad_capabilities)", async () => {
    const app = mountApp(tenantId);
    const res = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: uniqueName("BadCap"), canvasId: null, capabilities: ["fly"] }),
    });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { reason: string } } },
    ).toMatchObject({
      error: { code: "device_profile.invalid", params: { reason: "bad_capabilities" } },
    });
  });

  it("DELETE a profile a device still references → 409 device_profile.in_use, profile survives", async () => {
    const app = mountApp(tenantId);
    // Create a profile, then bind a device to it as the owner (fixture setup), reusing the
    // venue's provisioned location. The composite FK devices_device_profile_fk is ON DELETE RESTRICT, so
    // the DELETE trips a 23001 the store translates to device_profile.in_use → the house 409.
    const created = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: uniqueName("Referenced"), canvasId: null, capabilities: [] }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as ProfileRow;

    const location = await suite.admin.execute<{ id: string }>(
      sql`select id from locations where tenant_id = ${tenantId} limit 1`,
    );
    await suite.admin.execute(sql`
      insert into devices (tenant_id, location_id, device_kind, label, token_hash, device_profile_id)
      values (${tenantId}, ${location.rows[0]!.id}, 'till', ${uniqueName("Bound device")}, 'scrypt$00$00', ${id})`);

    const res = await app.request(`/management-api/device-profiles/${id}`, {
      method: "DELETE",
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device_profile.in_use" },
    });
    // The profile survived the refused delete (RESTRICT): GET still returns it.
    const got = await app.request(`/management-api/device-profiles/${id}`, {
      headers: { cookie: managerCookie },
    });
    expect(got.status).toBe(200);
  });

  it("POST a duplicate name → 409 device_profile.name_taken", async () => {
    const app = mountApp(tenantId);
    const name = uniqueName("Twin");
    const first = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name, canvasId: null, capabilities: [] }),
    });
    expect(first.status).toBe(201);
    const second = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name, canvasId: null, capabilities: [] }),
    });
    expect(second.status).toBe(409);
    expect((await second.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device_profile.name_taken" },
    });
  });

  it("POST with a malformed body → 400 management.request_invalid naming the field", async () => {
    const app = mountApp(tenantId);

    // A bare JSON array (not an object) → the body-shape screen.
    const arrayBody = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify([1, 2, 3]),
    });
    expect(arrayBody.status).toBe(400);
    expect(
      (await arrayBody.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "body" } } });

    // Missing name.
    const noName = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ canvasId: null, capabilities: [] }),
    });
    expect(noName.status).toBe(400);
    expect(
      (await noName.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "name" } } });

    // Missing capabilities.
    const noCaps = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: uniqueName("NoCaps"), canvasId: null }),
    });
    expect(noCaps.status).toBe(400);
    expect(
      (await noCaps.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "capabilities" } },
    });

    // A canvasId of the wrong TYPE (a number, neither string nor null) → the canvasId screen.
    const badCanvasType = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: uniqueName("BadType"), canvasId: 42, capabilities: [] }),
    });
    expect(badCanvasType.status).toBe(400);
    expect(
      (await badCanvasType.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "canvasId" } },
    });

    // A canvasId that is a string but NOT a UUID → the UUID-shape screen (`requireBodyUuid`), a clean
    // 400 rather than a downstream `22P02` 500 on the `canvas_id` uuid column.
    const malformedCanvas = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name: uniqueName("BadShape"),
        canvasId: "not-a-uuid",
        capabilities: [],
      }),
    });
    expect(malformedCanvas.status).toBe(400);
    expect(
      (await malformedCanvas.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "canvasId" } },
    });
  });

  it("PUT with a malformed body → 400 management.request_invalid naming the field", async () => {
    const app = mountApp(tenantId);
    // A real profile to target, so the body screen — not a not-found — is what fires.
    const created = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: uniqueName("Editable"), canvasId: null, capabilities: [] }),
    });
    const { id } = (await created.json()) as ProfileRow;

    // A bare JSON array (not an object) → the body-shape screen.
    const arrayBody = await app.request(`/management-api/device-profiles/${id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify([1, 2, 3]),
    });
    expect(arrayBody.status).toBe(400);
    expect(
      (await arrayBody.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "body" } } });

    // Missing name.
    const noName = await app.request(`/management-api/device-profiles/${id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ canvasId: null, capabilities: [] }),
    });
    expect(noName.status).toBe(400);
    expect(
      (await noName.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "name" } } });

    // Missing capabilities.
    const noCaps = await app.request(`/management-api/device-profiles/${id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: uniqueName("E2"), canvasId: null }),
    });
    expect(noCaps.status).toBe(400);
    expect(
      (await noCaps.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "capabilities" } },
    });

    // A canvasId of the wrong TYPE (a number, neither string nor null) → the canvasId screen.
    const badCanvasType = await app.request(`/management-api/device-profiles/${id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: uniqueName("E3"), canvasId: 42, capabilities: [] }),
    });
    expect(badCanvasType.status).toBe(400);
    expect(
      (await badCanvasType.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "canvasId" } },
    });
  });

  it("refuses every device-profile route for a STAFF-role session with 403 (the authorizeManager gate)", async () => {
    const app = mountApp(tenantId);
    const staffCookie = await login(app, STAFF_EMAIL);
    // Seed a profile as the manager so the GET-by-id / PUT / DELETE targets exist (the 403 must fire
    // regardless — the gate runs before any read/write).
    const created = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: uniqueName("Target"), canvasId: null, capabilities: [] }),
    });
    const { id } = (await created.json()) as ProfileRow;

    const cases = [
      app.request("/management-api/device-profiles", { headers: { cookie: staffCookie } }),
      app.request(`/management-api/device-profiles/${id}`, { headers: { cookie: staffCookie } }),
      app.request("/management-api/device-profiles", {
        method: "POST",
        headers: { ...JSON_HEADERS, cookie: staffCookie },
        body: JSON.stringify({ name: uniqueName("Nope"), canvasId: null, capabilities: [] }),
      }),
      app.request(`/management-api/device-profiles/${id}`, {
        method: "PUT",
        headers: { ...JSON_HEADERS, cookie: staffCookie },
        body: JSON.stringify({ name: uniqueName("Nope"), canvasId: null, capabilities: [] }),
      }),
      app.request(`/management-api/device-profiles/${id}`, {
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

  it("refuses the device-profile routes unauthenticated with 401", async () => {
    const app = mountApp(tenantId);
    const res = await app.request("/management-api/device-profiles");
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });
  });
});
