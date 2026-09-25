import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { devices, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { DEFAULT_CANVASES } from "@waitron/layouts";
import type { CanvasDef } from "@waitron/layouts";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";

/**
 * The device-profile CRUD routes end to end, over HTTP, with the manager and staff sessions a real
 * sign-in mints.
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
  return `${String(75_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Profile and canvas names are unique and the database is not reset between tests. */
function uniqueName(base: string): string {
  return `${base}-${randomUUID().slice(0, 8)}`;
}

function phoneCanvas(title: string): CanvasDef {
  const base = DEFAULT_CANVASES["phone-portrait"];
  return { ...base, tabs: [{ ...base.tabs[0]!, title }, ...base.tabs.slice(1)] };
}

async function setupTenant(): Promise<void> {
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

  // Through the table definition: `persons.id` and `persons.created_at` are `$defaultFn`
  // generators, which a raw SQL insert never reaches.
  await withTransaction(suite.db, async (tx) => {
    for (const [displayName, email, role] of [
      ["The Manager", MANAGER_EMAIL, "manager"],
      ["The Clerk", STAFF_EMAIL, "staff"],
    ] as const) {
      await tx.insert(persons).values({
        displayName,
        email,
        pinHash: hashPin("1234"),
        passwordHash: hashPassword(PASSWORD),
        role,
      });
    }
  });
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

type ProfileRow = {
  id: string;
  name: string;
  formFactor: string;
  canvasId: string | null;
  capabilities: string[];
  inactivityTimeoutSeconds: number | null;
};

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
  let managerCookie: string;

  beforeAll(async () => {
    await setupTenant();
    managerCookie = await login(mountApp(), MANAGER_EMAIL);
  });

  it("round-trips create → list → get → update → delete", async () => {
    const app = mountApp();
    const name = uniqueName("Front counter");

    // CREATE → 201, the stored row.
    const created = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name,
        formFactor: "till",
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
      formFactor: "till",
      canvasId: null,
      capabilities: ["integrated-card-payment", "open-cash-drawer"],
      inactivityTimeoutSeconds: null,
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
      formFactor: "till",
      canvasId: null,
      capabilities: ["integrated-card-payment", "open-cash-drawer"],
      inactivityTimeoutSeconds: null,
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
      body: JSON.stringify({
        name: renamed,
        formFactor: "kds",
        canvasId: null,
        capabilities: ["act-as-kds"],
      }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({
      id,
      name: renamed,
      formFactor: "kds",
      canvasId: null,
      capabilities: ["act-as-kds"],
      // A `kds` profile always coerces the timeout to null in the store, regardless of the body.
      inactivityTimeoutSeconds: null,
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
    const app = mountApp();
    const canvasId = await seedCanvas(app, managerCookie, uniqueName("Bound canvas"));
    const created = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name: uniqueName("Bound"),
        formFactor: "till",
        canvasId,
        capabilities: [],
      }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as ProfileRow;
    const got = await app.request(`/management-api/device-profiles/${id}`, {
      headers: { cookie: managerCookie },
    });
    expect(((await got.json()) as ProfileRow).canvasId).toBe(canvasId);
  });

  it("POST + PUT persist inactivityTimeoutSeconds; PUT wipes it when the key is omitted (full-replace)", async () => {
    const app = mountApp();
    const created = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name: uniqueName("Handheld"),
        formFactor: "phone-portrait",
        canvasId: null,
        capabilities: [],
        inactivityTimeoutSeconds: 300,
      }),
    });
    expect(created.status).toBe(201);
    const row = (await created.json()) as ProfileRow;
    expect(row.inactivityTimeoutSeconds).toBe(300);
    const { id } = row;

    // GET reads it back from the row.
    const got = await app.request(`/management-api/device-profiles/${id}`, {
      headers: { cookie: managerCookie },
    });
    expect(((await got.json()) as ProfileRow).inactivityTimeoutSeconds).toBe(300);

    // PUT with a NEW value replaces it.
    const updated = await app.request(`/management-api/device-profiles/${id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name: uniqueName("Handheld2"),
        formFactor: "phone-portrait",
        canvasId: null,
        capabilities: [],
        inactivityTimeoutSeconds: 120,
      }),
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as ProfileRow).inactivityTimeoutSeconds).toBe(120);

    // PUT with the key OMITTED stores null: the PUT is a full replacement.
    const wiped = await app.request(`/management-api/device-profiles/${id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name: uniqueName("Handheld3"),
        formFactor: "phone-portrait",
        canvasId: null,
        capabilities: [],
      }),
    });
    expect(wiped.status).toBe(200);
    expect(((await wiped.json()) as ProfileRow).inactivityTimeoutSeconds).toBeNull();
  });

  it("POST with a non-positive inactivityTimeoutSeconds → 400 device_profile.invalid (the store's domain rule)", async () => {
    const app = mountApp();
    // 0 and -5 pass the route's shape screen and are refused by the store's domain rule.
    for (const bad of [0, -5]) {
      const res = await app.request("/management-api/device-profiles", {
        method: "POST",
        headers: { ...JSON_HEADERS, cookie: managerCookie },
        body: JSON.stringify({
          name: uniqueName("BadTimeout"),
          formFactor: "phone-portrait",
          canvasId: null,
          capabilities: [],
          inactivityTimeoutSeconds: bad,
        }),
      });
      expect(res.status).toBe(400);
      expect(
        (await res.json()) as { error: { code: string; params: { reason: string } } },
      ).toMatchObject({
        error: { code: "device_profile.invalid", params: { reason: "bad_inactivity_timeout" } },
      });
    }
  });

  it("POST with a non-integer-typed inactivityTimeoutSeconds → 400 management.request_invalid (the server shape screen)", async () => {
    const app = mountApp();
    // A string and a fraction are refused by the route's shape screen, naming the field.
    for (const bad of ["300", 12.5]) {
      const res = await app.request("/management-api/device-profiles", {
        method: "POST",
        headers: { ...JSON_HEADERS, cookie: managerCookie },
        body: JSON.stringify({
          name: uniqueName("BadTimeoutType"),
          formFactor: "phone-portrait",
          canvasId: null,
          capabilities: [],
          inactivityTimeoutSeconds: bad,
        }),
      });
      expect(res.status).toBe(400);
      expect(
        (await res.json()) as { error: { code: string; params: { field: string } } },
      ).toMatchObject({
        error: {
          code: "management.request_invalid",
          params: { field: "inactivityTimeoutSeconds" },
        },
      });
    }
  });

  it("POST a kds profile coerces inactivityTimeoutSeconds to null even when a value is sent", async () => {
    const app = mountApp();
    // A kds display has no operator session to log out, so the store stores null whatever the body.
    const created = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name: uniqueName("Kitchen"),
        formFactor: "kds",
        canvasId: null,
        capabilities: ["act-as-kds"],
        inactivityTimeoutSeconds: 300,
      }),
    });
    expect(created.status).toBe(201);
    expect(((await created.json()) as ProfileRow).inactivityTimeoutSeconds).toBeNull();
  });

  it("GET by an unknown (well-formed) id → 404 device_profile.not_found", async () => {
    const app = mountApp();
    const res = await app.request(`/management-api/device-profiles/${randomUUID()}`, {
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device_profile.not_found" },
    });
  });

  it("GET by a MALFORMED id → 404 device_profile.not_found (the requireDeviceProfileId screen)", async () => {
    const app = mountApp();
    const res = await app.request("/management-api/device-profiles/not-a-uuid", {
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device_profile.not_found" },
    });
  });

  it("PUT to an unknown (well-formed) id → 404 device_profile.not_found (no silent no-op)", async () => {
    const app = mountApp();
    const res = await app.request(`/management-api/device-profiles/${randomUUID()}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name: uniqueName("Ghost"),
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device_profile.not_found" },
    });
  });

  it("DELETE an unknown (well-formed) id → 404 device_profile.not_found (no silent no-op)", async () => {
    const app = mountApp();
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
    const app = mountApp();
    const res = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name: uniqueName("BadRef"),
        formFactor: "till",
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
    const app = mountApp();
    const res = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name: uniqueName("BadCap"),
        formFactor: "till",
        canvasId: null,
        capabilities: ["fly"],
      }),
    });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { reason: string } } },
    ).toMatchObject({
      error: { code: "device_profile.invalid", params: { reason: "bad_capabilities" } },
    });
  });

  it("DELETE a profile a device still references → 409 device_profile.in_use, profile survives", async () => {
    const app = mountApp();
    // `devices.device_profile_id` is ON DELETE RESTRICT.
    const created = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name: uniqueName("Referenced"),
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as ProfileRow;

    const location = await suite.db.execute<{ id: string }>(sql`select id from locations  limit 1`);
    // A `till` profile's device must carry a till id (`device_binding_rule_insert`).
    const till = await suite.db.execute<{ id: string }>(sql`select id from tills  limit 1`);
    // Through the table definition, whose `$defaultFn` generators a raw SQL insert never reaches.
    await suite.db.insert(devices).values({
      locationId: location.rows[0]!.id,
      tillId: till.rows[0]!.id,
      label: uniqueName("Bound device"),
      tokenHash: "scrypt$00$00",
      deviceProfileId: id,
    });

    const res = await app.request(`/management-api/device-profiles/${id}`, {
      method: "DELETE",
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device_profile.in_use" },
    });
    const got = await app.request(`/management-api/device-profiles/${id}`, {
      headers: { cookie: managerCookie },
    });
    expect(got.status).toBe(200);
  });

  it("POST a duplicate name → 409 device_profile.name_taken", async () => {
    const app = mountApp();
    const name = uniqueName("Twin");
    const first = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name, formFactor: "till", canvasId: null, capabilities: [] }),
    });
    expect(first.status).toBe(201);
    const second = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name, formFactor: "till", canvasId: null, capabilities: [] }),
    });
    expect(second.status).toBe(409);
    expect((await second.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device_profile.name_taken" },
    });
  });

  it("POST with a malformed body → 400 management.request_invalid naming the field", async () => {
    const app = mountApp();

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

    // A canvasId that is a string but NOT a UUID → the UUID-shape screen (`requireBodyUuid`).
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

    // A missing OR out-of-set formFactor → the closed-set screen (`requireEnum` over FORM_FACTORS).
    for (const formFactor of [undefined, "watch"]) {
      const res = await app.request("/management-api/device-profiles", {
        method: "POST",
        headers: { ...JSON_HEADERS, cookie: managerCookie },
        body: JSON.stringify({
          name: uniqueName("BadFF"),
          ...(formFactor === undefined ? {} : { formFactor }),
          canvasId: null,
          capabilities: [],
        }),
      });
      expect(res.status).toBe(400);
      expect(
        (await res.json()) as { error: { code: string; params: { field: string } } },
      ).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "formFactor" } },
      });
    }
  });

  it("PUT with a malformed body → 400 management.request_invalid naming the field", async () => {
    const app = mountApp();
    // A real profile to target, so the body screen — not a not-found — is what fires.
    const created = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name: uniqueName("Editable"),
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
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
    const app = mountApp();
    const staffCookie = await login(app, STAFF_EMAIL);
    const created = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name: uniqueName("Target"),
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    });
    const { id } = (await created.json()) as ProfileRow;

    const cases = [
      app.request("/management-api/device-profiles", { headers: { cookie: staffCookie } }),
      app.request(`/management-api/device-profiles/${id}`, { headers: { cookie: staffCookie } }),
      app.request("/management-api/device-profiles", {
        method: "POST",
        headers: { ...JSON_HEADERS, cookie: staffCookie },
        body: JSON.stringify({
          name: uniqueName("Nope"),
          formFactor: "till",
          canvasId: null,
          capabilities: [],
        }),
      }),
      app.request(`/management-api/device-profiles/${id}`, {
        method: "PUT",
        headers: { ...JSON_HEADERS, cookie: staffCookie },
        body: JSON.stringify({
          name: uniqueName("Nope"),
          formFactor: "till",
          canvasId: null,
          capabilities: [],
        }),
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
    const app = mountApp();
    const res = await app.request("/management-api/device-profiles");
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });
  });
});
