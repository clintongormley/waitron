import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { deviceProfiles, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { DEFAULT_CANVASES } from "@waitron/layouts";
import type { CanvasDef, ThemeOverride } from "@waitron/layouts";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";

/**
 * The layout-canvas CRUD and theme routes end to end, over HTTP, with the manager and staff
 * sessions a real sign-in mints.
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

/** Canvas names are unique and the database is not reset between tests. */
function uniqueName(base: string): string {
  return `${base}-${randomUUID().slice(0, 8)}`;
}

/** The title tells a stored row from a default, and one round-trip from another. */
function phoneCanvas(title: string): CanvasDef {
  const base = DEFAULT_CANVASES["phone-portrait"];
  return { ...base, tabs: [{ ...base.tabs[0]!, title }, ...base.tabs.slice(1)] };
}

/** The database is not reset between tests, so every group shares the venue provisioned first. */
let provisioned: Promise<Record<string, never>> | undefined;
function setupTenant(): Promise<Record<string, never>> {
  provisioned ??= provisionTenant();
  return provisioned;
}

async function provisionTenant(): Promise<Record<string, never>> {
  await applyVenue(
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

  // Through the table definitions: `persons.id` and `persons.created_at` are `$defaultFn`
  // generators, which a raw SQL insert never reaches.
  await withTransaction(suite.db, async (tx) => {
    await tx.insert(persons).values([
      {
        displayName: "The Manager",
        email: MANAGER_EMAIL,
        pinHash: hashPin("1234"),
        passwordHash: hashPassword(PASSWORD),
        role: "manager",
      },
      {
        displayName: "The Clerk",
        email: STAFF_EMAIL,
        pinHash: hashPin("1234"),
        passwordHash: hashPassword(PASSWORD),
        role: "staff",
      },
    ]);
  });
  return {};
}

function mountApp(): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: "00000000-0000-0000-0000-000000000000" },
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

const JSON_HEADERS = { "content-type": "application/json" };

describe("Management API — layout-canvas CRUD (Task 11)", () => {
  let managerCookie: string;

  beforeAll(async () => {
    await setupTenant();
    managerCookie = await login(mountApp(), MANAGER_EMAIL);
  });

  it("round-trips create → list → get → update → delete", async () => {
    const app = mountApp();
    const name = uniqueName("Front counter");
    const definition = phoneCanvas("Floor A");

    // CREATE → 201 { id }
    const created = await app.request("/management-api/canvases", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name, definition }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(typeof id).toBe("string");

    // GET by id → the stored canvas
    const got = await app.request(`/management-api/canvases/${id}`, {
      headers: { cookie: managerCookie },
    });
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual({ id, name, definition });

    // LIST includes it
    const listed = await app.request("/management-api/canvases", {
      headers: { cookie: managerCookie },
    });
    expect(listed.status).toBe(200);
    const { canvases } = (await listed.json()) as {
      canvases: { id: string; name: string; definition: CanvasDef }[];
    };
    expect(canvases.some((p) => p.id === id && p.name === name)).toBe(true);

    // UPDATE → 204, then GET reads back the new name + definition
    const renamed = uniqueName("Renamed");
    const nextDef = phoneCanvas("Floor B");
    const updated = await app.request(`/management-api/canvases/${id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: renamed, definition: nextDef }),
    });
    expect(updated.status).toBe(204);
    expect(await updated.text()).toBe("");
    const afterUpdate = await app.request(`/management-api/canvases/${id}`, {
      headers: { cookie: managerCookie },
    });
    expect(await afterUpdate.json()).toEqual({ id, name: renamed, definition: nextDef });

    // DELETE → 204, then GET → 404 canvas.not_found
    const removed = await app.request(`/management-api/canvases/${id}`, {
      method: "DELETE",
      headers: { cookie: managerCookie },
    });
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe("");
    const afterDelete = await app.request(`/management-api/canvases/${id}`, {
      headers: { cookie: managerCookie },
    });
    expect(afterDelete.status).toBe(404);
    expect((await afterDelete.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "canvas.not_found" },
    });
  });

  it("GET by an unknown (well-formed) id → 404 canvas.not_found", async () => {
    const app = mountApp();
    const res = await app.request(`/management-api/canvases/${randomUUID()}`, {
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "canvas.not_found" },
    });
  });

  it("PUT to an unknown (well-formed) id → 404 canvas.not_found (no silent no-op)", async () => {
    const app = mountApp();
    const res = await app.request(`/management-api/canvases/${randomUUID()}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: uniqueName("Ghost"), definition: phoneCanvas("None") }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "canvas.not_found" },
    });
  });

  it("DELETE an unknown (well-formed) id → 404 canvas.not_found (no silent no-op)", async () => {
    const app = mountApp();
    const res = await app.request(`/management-api/canvases/${randomUUID()}`, {
      method: "DELETE",
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "canvas.not_found" },
    });
  });

  it("DELETE a canvas a device profile still references → 409 canvas.in_use, canvas survives", async () => {
    const app = mountApp();
    // `device_profiles.canvas_id` is ON DELETE RESTRICT.
    const created = await app.request("/management-api/canvases", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: uniqueName("Referenced"), definition: phoneCanvas("Bound") }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    await suite.db
      .insert(deviceProfiles)
      .values({ name: uniqueName("Binding profile"), formFactor: "till", canvasId: id });

    const res = await app.request(`/management-api/canvases/${id}`, {
      method: "DELETE",
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "canvas.in_use" },
    });
    const got = await app.request(`/management-api/canvases/${id}`, {
      headers: { cookie: managerCookie },
    });
    expect(got.status).toBe(200);
  });

  it("GET by a MALFORMED id → 404 canvas.not_found (the requireCanvasId screen)", async () => {
    const app = mountApp();
    const res = await app.request("/management-api/canvases/not-a-uuid", {
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "canvas.not_found" },
    });
  });

  it("POST with an invalid definition → 400 canvas.invalid", async () => {
    const app = mountApp();
    const res = await app.request("/management-api/canvases", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: uniqueName("Bad"), definition: {} }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "canvas.invalid" },
    });
  });

  it("POST with a body missing name / definition → 400 management.request_invalid naming the field", async () => {
    const app = mountApp();
    const noName = await app.request("/management-api/canvases", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ definition: phoneCanvas("x") }),
    });
    expect(noName.status).toBe(400);
    expect(
      (await noName.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "name" } },
    });

    const noDef = await app.request("/management-api/canvases", {
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
    const arrayBody = await app.request("/management-api/canvases", {
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
    const app = mountApp();
    // A real canvas to target, so the body screen — not a not-found — is what fires.
    const created = await app.request("/management-api/canvases", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: uniqueName("Editable"), definition: phoneCanvas("E") }),
    });
    const { id } = (await created.json()) as { id: string };

    // A bare JSON array (not an object) → the body-shape screen.
    const arrayBody = await app.request(`/management-api/canvases/${id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify([1, 2, 3]),
    });
    expect(arrayBody.status).toBe(400);
    expect(
      (await arrayBody.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "body" } } });

    // Missing name.
    const noName = await app.request(`/management-api/canvases/${id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ definition: phoneCanvas("E2") }),
    });
    expect(noName.status).toBe(400);
    expect(
      (await noName.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "name" } } });

    // Missing definition.
    const noDef = await app.request(`/management-api/canvases/${id}`, {
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

  it("POST a duplicate name → 409 canvas.name_taken", async () => {
    const app = mountApp();
    const name = uniqueName("Twin");
    const first = await app.request("/management-api/canvases", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name, definition: phoneCanvas("First") }),
    });
    expect(first.status).toBe(201);

    const second = await app.request("/management-api/canvases", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name, definition: phoneCanvas("Second") }),
    });
    expect(second.status).toBe(409);
    expect((await second.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "canvas.name_taken" },
    });
  });

  it("refuses every canvas route for a STAFF-role session with 403 (the authorizeManager gate)", async () => {
    const app = mountApp();
    const staffCookie = await login(app, STAFF_EMAIL);
    const created = await app.request("/management-api/canvases", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: uniqueName("Target"), definition: phoneCanvas("T") }),
    });
    const { id } = (await created.json()) as { id: string };

    const cases = [
      app.request("/management-api/canvases", { headers: { cookie: staffCookie } }),
      app.request(`/management-api/canvases/${id}`, { headers: { cookie: staffCookie } }),
      app.request("/management-api/canvases", {
        method: "POST",
        headers: { ...JSON_HEADERS, cookie: staffCookie },
        body: JSON.stringify({ name: uniqueName("Nope"), definition: phoneCanvas("N") }),
      }),
      app.request(`/management-api/canvases/${id}`, {
        method: "PUT",
        headers: { ...JSON_HEADERS, cookie: staffCookie },
        body: JSON.stringify({ name: uniqueName("Nope"), definition: phoneCanvas("N") }),
      }),
      app.request(`/management-api/canvases/${id}`, {
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

  it("refuses the canvas routes unauthenticated with 401", async () => {
    const app = mountApp();
    const res = await app.request("/management-api/canvases");
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });
  });
});

describe("Management API — tenant theme (Task 11)", () => {
  let managerCookie: string;

  beforeAll(async () => {
    await setupTenant();
    managerCookie = await login(mountApp(), MANAGER_EMAIL);
  });

  it("GET returns { theme: null } for a tenant that has never authored a theme", async () => {
    const app = mountApp();
    const res = await app.request("/management-api/theme", { headers: { cookie: managerCookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ theme: null });
  });

  it("PUT → 204, then GET reads the theme back (round-trip)", async () => {
    const app = mountApp();
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
    const app = mountApp();
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
    const app = mountApp();
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

    // A JSON `null` body is read as `{}`, so the same field screen answers.
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
    const app = mountApp();
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
    const app = mountApp();
    const res = await app.request("/management-api/theme");
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });
  });
});
