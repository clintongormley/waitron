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
 *
 * ## What went with PostgreSQL
 *
 * SQLite has no roles and no grants, and every call below runs on the one handle. Nothing here
 * now says anything about which identity the routes reach the database as. The 403 and 401 gates
 * are `authorizeManager` and `requireManagementSession` rather than privileges, so they are
 * unaffected — and still pass.
 *
 * **One deletion receipt written into a case below is retired by the column types, and is flagged
 * where it sits** (the malformed-`canvasId` screen in the POST body case). `device_profiles.canvas_id`
 * is `text` with a foreign key to `canvases`
 * (`packages/db/drizzle/0000_baseline.sql:492,:497`), so a non-UUID string reaching the column
 * cannot raise the `22P02` that screen was recorded as forestalling. The screen still fires first,
 * so the case still pins the response.
 *
 * The `device_profile.in_use` case is NOT in that category and keeps its subject: the
 * `devices.device_profile_id` → `device_profiles.id` key survived the regeneration with `ON DELETE
 * restrict`, the store opens with `pragma foreign_keys = on` (`packages/store/src/index.ts`), and
 * `translateWriteError` already reads this engine's restrict code
 * (`packages/layouts/src/device-profile-store.test.ts:79-91`).
 */
const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // ≥ MIN_PASSWORD_LENGTH; the manager's & staff's seeded password.
const MANAGER_EMAIL = "manager@x.com";
const STAFF_EMAIL = "clerk@x.com";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

/** A no-op logger: only the HTTP responses and the database state matter here. */
const noopLog: Logger = () => {};

// One NIF per provisioned venue: `resetPerTest` is off, so tenants accumulate for the life of the
// file and the country + tax id pair is unique.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(75_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** A profile (or canvas) name unique within the tenant, so tests are order-independent
 *  (CLAUDE.md §4) — `resetPerTest` is off, so the profile set accumulates across tests and `(name)`
 *  is unique, so a fixed name could collide across tests. */
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

  // Seeded through the table definition, not by raw SQL: `persons.id` and `persons.created_at` are
  // `$defaultFn` generators on this engine, which a raw insert never reaches while the columns are
  // NOT NULL (`packages/identity/src/schema/persons.ts`).
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
      // nodeId sentinel: the device-profile management routes never read cfg.nodeId, but
      // mountManagementApi's cfg requires it (identity-config flow-down, #195). Matches the sibling
      // management tests (management-api.canvases.test.ts, …-status/-passkey).
      cfg: { nodeId: "00000000-0000-0000-0000-000000000000" },
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

type ProfileRow = {
  id: string;
  name: string;
  formFactor: string;
  canvasId: string | null;
  capabilities: string[];
  inactivityTimeoutSeconds: number | null;
};

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
  let managerCookie: string;

  beforeAll(async () => {
    await setupTenant();
    managerCookie = await login(mountApp(), MANAGER_EMAIL);
  });

  it("round-trips create → list → get → update → delete", async () => {
    const app = mountApp();
    const name = uniqueName("Front counter");

    // CREATE → 201, the stored row (canvasId null, the two till capabilities).
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
      // No `inactivityTimeoutSeconds` in the body → the route defaults it to null (the app default).
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
    // CREATE a `phone-portrait` (handheld) profile carrying a 300 s auto-logout timeout — the store
    // keeps a positive integer for a non-kds form factor. The created row echoes it.
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

    // PUT with the key OMITTED wipes the value to null — full-replace, matching `canvasId`'s convention.
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
    // 0 and -5 clear the server SHAPE screen (both integers) and reach the store, whose
    // `validateInactivityTimeout` rejects a non-null value < 1 → device_profile.invalid.
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
    // A string and a fractional number are neither null nor an integer number, so the server SHAPE
    // screen refuses them naming the field — before the store's domain rule is reached.
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
    // A kds display has no operator session to log out, so the store forces the timeout to null
    // regardless of the body value (validateInactivityTimeout returns null for `kds`).
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
    // Create a profile, then bind a device to it (fixture setup), reusing the venue's provisioned
    // location. The `device_profile_id` key is ON DELETE restrict, so the DELETE trips the engine's
    // restrict refusal, which the store translates to device_profile.in_use → the house 409
    // (`packages/layouts/src/device-profile-store.test.ts:79-91`).
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
    // The profile is a `till` form factor, so `device_binding_rule_insert / _update` requires the device to carry a
    // till_id (and no station) — bind the venue's provisioned till (fixture setup).
    const till = await suite.db.execute<{ id: string }>(sql`select id from tills  limit 1`);
    // Through the table definition: `devices.id`, `enrolled_at` and `created_at` are `$defaultFn`
    // generators on NOT NULL columns, which a raw insert never reaches
    // (`packages/db/src/schema/devices.ts`).
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
    // The profile survived the refused delete (RESTRICT): GET still returns it.
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
    // The downstream consequence this case recorded — a `22P02` 500 on a `uuid` column — is retired
    // by `canvas_id` now being `text` (see the header). The screen still fires first.
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

    // A missing OR out-of-set formFactor → the closed-set screen (`requireEnum` over FORM_FACTORS),
    // naming the field — so the `device_form_factor` enum column never sees a value it cannot hold.
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
    // Seed a profile as the manager so the GET-by-id / PUT / DELETE targets exist (the 403 must fire
    // regardless — the gate runs before any read/write).
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
