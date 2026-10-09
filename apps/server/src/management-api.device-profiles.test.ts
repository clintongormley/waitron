import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { devices, printers, withTransaction } from "@waitron/db";
import { createCatalogue } from "@waitron/catalogue";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { DEFAULT_CANVASES } from "@waitron/layouts";
import type { CanvasDef } from "@waitron/layouts";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  createDepartment,
  createServiceZone,
  deactivateServiceZone,
  zoneServicePolicies,
} from "@waitron/venue-service";
import type { Logger } from "./logger.js";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES, VENUE_SERVICE } from "./modules.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { createStation } from "./kitchen.js";
import type { TillConfig } from "./till-config.js";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
} from "@waitron/shared";

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

/** The venue the station and watcher list routes are scoped to, as boot threads it. */
let venueCfg: TillConfig;

/** The provisioned counter's department and zone: a profile that is not a kitchen display must
 * name a department to be saved. */
let ordering: { departmentId: string; startingZoneId: string };

async function setupTenant(): Promise<void> {
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
  venueCfg = {
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const [counter] = await suite.db
    .select({ departmentId: zoneServicePolicies.departmentId, zoneId: zoneServicePolicies.zoneId })
    .from(zoneServicePolicies);
  ordering = { departmentId: counter!.departmentId, startingZoneId: counter!.zoneId };

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

let tenant: Promise<void> | undefined;

/** Each describe that needs the venue waits for the one setup, so it also runs on its own. */
function setupTenantOnce(): Promise<void> {
  return (tenant ??= setupTenant());
}

function mountApp(): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: "00000000-0000-0000-0000-000000000000" },
      venueCfg,
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
      credentialKeyRing: TOTP_KEY_RING,
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
  receiptPrinterIds: string[];
  paymentSlipPrinterIds: string[];
  cashDrawerPrinterIds: string[];
  receiptPrinterDefaultId: string | null;
  paymentSlipPrinterDefaultId: string | null;
  cashDrawerPrinterDefaultId: string | null;
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
    await setupTenantOnce();
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
        ...ordering,
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
      receiptPrinterIds: [],
      paymentSlipPrinterIds: [],
      cashDrawerPrinterIds: [],
      receiptPrinterDefaultId: null,
      paymentSlipPrinterDefaultId: null,
      cashDrawerPrinterDefaultId: null,
      startingScreen: null,
      departmentId: ordering.departmentId,
      allowedZoneIds: null,
      startingZoneId: ordering.startingZoneId,
      admittedRoles: ["staff", "supervisor", "manager", "admin"],
      personExceptions: [],
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
      receiptPrinterIds: [],
      paymentSlipPrinterIds: [],
      cashDrawerPrinterIds: [],
      receiptPrinterDefaultId: null,
      paymentSlipPrinterDefaultId: null,
      cashDrawerPrinterDefaultId: null,
      startingScreen: null,
      departmentId: ordering.departmentId,
      allowedZoneIds: null,
      startingZoneId: ordering.startingZoneId,
      admittedRoles: ["staff", "supervisor", "manager", "admin"],
      personExceptions: [],
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
      receiptPrinterIds: [],
      paymentSlipPrinterIds: [],
      cashDrawerPrinterIds: [],
      receiptPrinterDefaultId: null,
      paymentSlipPrinterDefaultId: null,
      cashDrawerPrinterDefaultId: null,
      startingScreen: null,
      departmentId: null,
      allowedZoneIds: null,
      startingZoneId: null,
      admittedRoles: ["staff", "supervisor", "manager", "admin"],
      personExceptions: [],
      narrowedDevices: [],
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
        ...ordering,
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

  it("saves the three screen switches and reads them back", async () => {
    const app = mountApp();
    const created = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name: uniqueName("Screens"),
        formFactor: "phone-portrait",
        ...ordering,
        canvasId: null,
        capabilities: ["show-station", "show-expo", "show-schedule"],
      }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as ProfileRow;
    const got = await app.request(`/management-api/device-profiles/${id}`, {
      headers: { cookie: managerCookie },
    });
    expect(got.status).toBe(200);
    expect(((await got.json()) as ProfileRow).capabilities).toEqual([
      "show-station",
      "show-expo",
      "show-schedule",
    ]);
  });

  it("POST + PUT persist inactivityTimeoutSeconds; PUT wipes it when the key is omitted (full-replace)", async () => {
    const app = mountApp();
    const created = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name: uniqueName("Handheld"),
        formFactor: "phone-portrait",
        ...ordering,
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

  it("DELETE a profile an active device holds → 409 device_profile.in_use, profile survives", async () => {
    const app = mountApp();
    const created = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name: uniqueName("Referenced"),
        formFactor: "till",
        ...ordering,
        canvasId: null,
        capabilities: [],
      }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as ProfileRow;

    const location = await suite.db.execute<{ id: string }>(sql`select id from locations  limit 1`);
    // Through the table definition, whose `$defaultFn` generators a raw SQL insert never reaches.
    await suite.db.insert(devices).values({
      locationId: location.rows[0]!.id,
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
      body: JSON.stringify({
        name,
        formFactor: "till",
        canvasId: null,
        capabilities: [],
        ...ordering,
      }),
    });
    expect(first.status).toBe(201);
    const second = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name,
        formFactor: "till",
        canvasId: null,
        capabilities: [],
        ...ordering,
      }),
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
        ...ordering,
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
        ...ordering,
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

  async function seedPrinter(name: string): Promise<string> {
    const location = await suite.db.execute<{ id: string }>(sql`select id from locations limit 1`);
    const [row] = await suite.db
      .insert(printers)
      .values({
        locationId: location.rows[0]!.id,
        name,
        transport: "network_tcp",
        host: "10.0.0.9",
      })
      .returning({ id: printers.id });
    return row!.id;
  }

  it("stores a profile's receipt and payment slip printer lists and reads them back", async () => {
    const app = mountApp();
    const p1 = await seedPrinter(uniqueName("Bar"));
    const created = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name: uniqueName("Listed"),
        formFactor: "till",
        ...ordering,
        canvasId: null,
        capabilities: [],
        receiptPrinterIds: [p1],
        paymentSlipPrinterIds: [],
      }),
    });
    expect(created.status).toBe(201);
    const row = (await created.json()) as ProfileRow;
    expect(row.receiptPrinterIds).toEqual([p1]);
    expect(row.paymentSlipPrinterIds).toEqual([]);
    const got = await app.request(`/management-api/device-profiles/${row.id}`, {
      headers: { cookie: managerCookie },
    });
    expect(await got.json()).toEqual(row);
    const listed = await app.request("/management-api/device-profiles", {
      headers: { cookie: managerCookie },
    });
    const { deviceProfiles } = (await listed.json()) as { deviceProfiles: ProfileRow[] };
    expect(deviceProfiles.find((p) => p.id === row.id)).toEqual(row);
  });

  it("PUT without the lists keeps them; PUT with an empty receipt list empties it and moves the profile's devices to no receipt printer", async () => {
    const app = mountApp();
    const p1 = await seedPrinter(uniqueName("Counter"));
    const p2 = await seedPrinter(uniqueName("Portable"));
    const name = uniqueName("Kept");
    const created = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name,
        formFactor: "till",
        ...ordering,
        canvasId: null,
        capabilities: [],
        receiptPrinterIds: [p1],
        paymentSlipPrinterIds: [p2],
      }),
    });
    const { id } = (await created.json()) as ProfileRow;
    const location = await suite.db.execute<{ id: string }>(sql`select id from locations limit 1`);
    const [device] = await suite.db
      .insert(devices)
      .values({
        locationId: location.rows[0]!.id,
        label: uniqueName("Listed device"),
        tokenHash: "scrypt$00$00",
        deviceProfileId: id,
        receiptPrinterId: p1,
        paymentSlipPrinterId: p2,
      })
      .returning({ id: devices.id });

    const kept = await app.request(`/management-api/device-profiles/${id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name, formFactor: "till", canvasId: null, capabilities: [] }),
    });
    expect(kept.status).toBe(200);
    const keptRow = (await kept.json()) as ProfileRow;
    expect(keptRow.receiptPrinterIds).toEqual([p1]);
    expect(keptRow.paymentSlipPrinterIds).toEqual([p2]);

    const emptied = await app.request(`/management-api/device-profiles/${id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        name,
        formFactor: "till",
        canvasId: null,
        capabilities: [],
        receiptPrinterIds: [],
      }),
    });
    expect(emptied.status).toBe(200);
    const emptiedRow = (await emptied.json()) as ProfileRow;
    expect(emptiedRow.receiptPrinterIds).toEqual([]);
    expect(emptiedRow.paymentSlipPrinterIds).toEqual([p2]);
    const [stored] = await suite.db
      .select({
        receiptPrinterId: devices.receiptPrinterId,
        paymentSlipPrinterId: devices.paymentSlipPrinterId,
      })
      .from(devices)
      .where(eq(devices.id, device!.id));
    expect(stored).toEqual({ receiptPrinterId: null, paymentSlipPrinterId: p2 });
  });

  it("stores a drawer list and each role's default, keeps a default a PUT omits, and refuses one not listed", async () => {
    const app = mountApp();
    const counter = await seedPrinter(uniqueName("Counter"));
    const [drawer] = await suite.db
      .insert(printers)
      .values({
        locationId: (await suite.db.execute<{ id: string }>(sql`select id from locations limit 1`))
          .rows[0]!.id,
        name: uniqueName("Drawer"),
        transport: "network_tcp",
        host: "10.0.0.9",
        hasCashDrawer: true,
      })
      .returning({ id: printers.id });
    const name = uniqueName("Defaults");
    const base = { name, formFactor: "till", ...ordering, canvasId: null, capabilities: [] };
    const created = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        ...base,
        receiptPrinterIds: [counter],
        receiptPrinterDefaultId: counter,
        cashDrawerPrinterIds: [drawer!.id],
        cashDrawerPrinterDefaultId: drawer!.id,
      }),
    });
    expect(created.status).toBe(201);
    const row = (await created.json()) as ProfileRow & Record<string, unknown>;
    expect(row).toMatchObject({
      receiptPrinterIds: [counter],
      receiptPrinterDefaultId: counter,
      paymentSlipPrinterDefaultId: null,
      cashDrawerPrinterIds: [drawer!.id],
      cashDrawerPrinterDefaultId: drawer!.id,
    });

    const kept = await app.request(`/management-api/device-profiles/${row.id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ ...base, receiptPrinterDefaultId: null }),
    });
    expect(kept.status).toBe(200);
    expect(await kept.json()).toMatchObject({
      receiptPrinterIds: [counter],
      receiptPrinterDefaultId: null,
      cashDrawerPrinterDefaultId: drawer!.id,
    });

    const refused = await app.request(`/management-api/device-profiles/${row.id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ ...base, paymentSlipPrinterDefaultId: counter }),
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({
      error: {
        code: "device_profile.invalid",
        params: { reason: "default_not_listed", field: "paymentSlipPrinterDefaultId" },
      },
    });
    const noDrawer = await app.request(`/management-api/device-profiles/${row.id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ ...base, cashDrawerPrinterIds: [drawer!.id, counter] }),
    });
    expect(noDrawer.status).toBe(400);
    expect(await noDrawer.json()).toMatchObject({
      error: { code: "device_profile.invalid", params: { reason: "no_cash_drawer" } },
    });
    const malformed = await app.request(`/management-api/device-profiles/${row.id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ ...base, cashDrawerPrinterDefaultId: "nope" }),
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
      error: {
        code: "management.request_invalid",
        params: { field: "cashDrawerPrinterDefaultId" },
      },
    });
  });

  it("refuses a printer list that is not an array of ids, and a printer that does not exist", async () => {
    const app = mountApp();
    const base = { formFactor: "till", canvasId: null, capabilities: [], ...ordering };
    const DUPLICATE = randomUUID();
    for (const [field, value] of [
      ["receiptPrinterIds", "x"],
      ["paymentSlipPrinterIds", ["not-a-uuid"]],
      ["receiptPrinterIds", null],
      ["receiptPrinterIds", [DUPLICATE, DUPLICATE]],
    ] as const) {
      const res = await app.request("/management-api/device-profiles", {
        method: "POST",
        headers: { ...JSON_HEADERS, cookie: managerCookie },
        body: JSON.stringify({ ...base, name: uniqueName("Bad list"), [field]: value }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field } },
      });
    }

    const ghost = randomUUID();
    const name = uniqueName("Ghost printer");
    const res = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ ...base, name, paymentSlipPrinterIds: [ghost] }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: "printer.not_found", params: { id: ghost } },
    });
    const listed = await app.request("/management-api/device-profiles", {
      headers: { cookie: managerCookie },
    });
    const { deviceProfiles } = (await listed.json()) as { deviceProfiles: ProfileRow[] };
    expect(deviceProfiles.some((p) => p.name === name)).toBe(false);

    const existing = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ ...base, name: uniqueName("Ghost on update") }),
    });
    const { id, name: existingName } = (await existing.json()) as ProfileRow;
    const update = await app.request(`/management-api/device-profiles/${id}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ ...base, name: existingName, receiptPrinterIds: [ghost] }),
    });
    expect(update.status).toBe(404);
    expect(await update.json()).toMatchObject({ error: { code: "printer.not_found" } });
  });

  it("answers a staff session 403 before looking at the printers it names", async () => {
    const app = mountApp();
    const staffCookie = await login(app, STAFF_EMAIL);
    const res = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: staffCookie },
      body: JSON.stringify({
        name: uniqueName("Staff"),
        formFactor: "till",
        canvasId: null,
        capabilities: [],
        receiptPrinterIds: [randomUUID()],
      }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  });

  describe("a kitchen display profile's kitchen screens", () => {
    async function kitchenChoices() {
      return withTransaction(suite.db, async (tx) => ({
        grill: (await createStation(tx, venueCfg, { name: uniqueName("Grill") })).id,
        cold: (await createStation(tx, venueCfg, { name: uniqueName("Cold") })).id,
      }));
    }

    async function screensOf(app: Hono, profileId: string): Promise<unknown> {
      const res = await app.request("/management-api/device-profile-kitchen-screens", {
        headers: { cookie: managerCookie },
      });
      expect(res.status).toBe(200);
      return (
        (await res.json()) as { profiles: { profileId: string; screens: unknown }[] }
      ).profiles.find((entry) => entry.profileId === profileId)?.screens;
    }

    const kitchen = (name: string, extra: Record<string, unknown> = {}) => ({
      name,
      formFactor: "kds",
      canvasId: null,
      capabilities: ["act-as-kds", "prepare-orders"],
      ...extra,
    });

    it("removing a station a device shows saves, narrows the device and names it with the station", async () => {
      const app = mountApp();
      const { grill, cold } = await kitchenChoices();
      const name = uniqueName("Kitchen");
      const created = await app.request("/management-api/device-profiles", {
        method: "POST",
        headers: { ...JSON_HEADERS, cookie: managerCookie },
        body: JSON.stringify(
          kitchen(name, {
            kitchenScreens: { station: { stationIds: [grill, cold], zoneIds: null } },
          }),
        ),
      });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as ProfileRow;
      const deviceName = uniqueName("Grill screen");
      const deviceId = await withTransaction(suite.db, async (tx) => {
        const [device] = await tx
          .insert(devices)
          .values({
            locationId: venueCfg.locationId,
            label: deviceName,
            tokenHash: "scrypt$00$00",
            deviceProfileId: id,
          })
          .returning({ id: devices.id });
        await VENUE_SERVICE.setDeviceKitchenScreens(tx, venueCfg, {
          deviceId: device!.id,
          profileId: id,
          screens: [{ kind: "station", stationIds: [grill, cold], zoneIds: null }],
        });
        return device!.id;
      });
      const renamed = uniqueName("Renamed");

      const res = await app.request(`/management-api/device-profiles/${id}`, {
        method: "PUT",
        headers: { ...JSON_HEADERS, cookie: managerCookie },
        body: JSON.stringify(
          kitchen(renamed, { kitchenScreens: { station: { stationIds: [cold], zoneIds: null } } }),
        ),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ProfileRow & { narrowedDevices: unknown };
      expect(body.name).toBe(renamed);
      const grillName = await withTransaction(suite.db, async (tx) =>
        (await VENUE_SERVICE.readDeviceKitchenScreens(tx, venueCfg, deviceId))[0]!.stations.find(
          (slot) => slot.id === grill,
        ),
      );
      expect(grillName).toMatchObject({ id: grill, available: false });
      expect(body.narrowedDevices).toEqual([
        {
          deviceId,
          deviceName,
          lost: { screens: [], stations: [{ id: grill, name: grillName!.name }], zones: [] },
        },
      ]);
      expect(await screensOf(app, id)).toEqual({ station: { stationIds: [cold], zoneIds: null } });
    });

    it("lists every live profile's kitchen screens, replaces them on a PUT naming them and keeps them on one without", async () => {
      const app = mountApp();
      const { grill, cold } = await kitchenChoices();
      const name = uniqueName("Kitchen");
      const offered = {
        station: { stationIds: [grill], zoneIds: null },
        pass: { stationIds: null, zoneIds: null },
      };
      const created = await app.request("/management-api/device-profiles", {
        method: "POST",
        headers: { ...JSON_HEADERS, cookie: managerCookie },
        body: JSON.stringify(kitchen(name, { kitchenScreens: offered })),
      });
      expect(created.status).toBe(201);
      const createdBody = (await created.json()) as ProfileRow;
      expect(createdBody).not.toHaveProperty("narrowedDevices");
      const { id } = createdBody;
      const bare = await app.request("/management-api/device-profiles", {
        method: "POST",
        headers: { ...JSON_HEADERS, cookie: managerCookie },
        body: JSON.stringify(kitchen(uniqueName("Bare"))),
      });
      const bareId = ((await bare.json()) as ProfileRow).id;
      expect(await screensOf(app, id)).toEqual(offered);
      expect(await screensOf(app, bareId)).toEqual({});

      const kept = await app.request(`/management-api/device-profiles/${id}`, {
        method: "PUT",
        headers: { ...JSON_HEADERS, cookie: managerCookie },
        body: JSON.stringify(kitchen(name)),
      });
      expect(kept.status).toBe(200);
      expect(((await kept.json()) as { narrowedDevices: unknown }).narrowedDevices).toEqual([]);
      expect(await screensOf(app, id)).toEqual(offered);

      const replaced = await app.request(`/management-api/device-profiles/${id}`, {
        method: "PUT",
        headers: { ...JSON_HEADERS, cookie: managerCookie },
        body: JSON.stringify(
          kitchen(name, { kitchenScreens: { station: { stationIds: [cold], zoneIds: null } } }),
        ),
      });
      expect(replaced.status).toBe(200);
      expect(await screensOf(app, id)).toEqual({ station: { stationIds: [cold], zoneIds: null } });
    });

    it("stores a pass monitor on a till profile", async () => {
      const app = mountApp();
      const created = await app.request("/management-api/device-profiles", {
        method: "POST",
        headers: { ...JSON_HEADERS, cookie: managerCookie },
        body: JSON.stringify({
          name: uniqueName("Till"),
          formFactor: "till",
          ...ordering,
          canvasId: null,
          capabilities: [],
        }),
      });
      expect(created.status).toBe(201);
      const { id, name } = (await created.json()) as ProfileRow;
      const res = await app.request(`/management-api/device-profiles/${id}`, {
        method: "PUT",
        headers: { ...JSON_HEADERS, cookie: managerCookie },
        body: JSON.stringify({
          name,
          formFactor: "till",
          canvasId: null,
          capabilities: [],
          kitchenScreens: { pass_monitor: { stationIds: null, zoneIds: null } },
        }),
      });
      expect(res.status).toBe(200);
      expect(await screensOf(app, id)).toEqual({
        pass_monitor: { stationIds: null, zoneIds: null },
      });
    });

    it("moves a kitchen display profile with a pass monitor to a till, keeping its pass monitor", async () => {
      const app = mountApp();
      const name = uniqueName("Monitor");
      const monitor = { pass_monitor: { stationIds: null, zoneIds: null } };
      const created = await app.request("/management-api/device-profiles", {
        method: "POST",
        headers: { ...JSON_HEADERS, cookie: managerCookie },
        body: JSON.stringify(kitchen(name, { kitchenScreens: monitor })),
      });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as ProfileRow;
      const asTill = (extra: Record<string, unknown> = {}) => ({
        name,
        formFactor: "till",
        ...ordering,
        canvasId: null,
        capabilities: [],
        ...extra,
      });

      const moved = await app.request(`/management-api/device-profiles/${id}`, {
        method: "PUT",
        headers: { ...JSON_HEADERS, cookie: managerCookie },
        body: JSON.stringify(asTill()),
      });
      expect(moved.status).toBe(200);
      const stored = await app.request(`/management-api/device-profiles/${id}`, {
        headers: { cookie: managerCookie },
      });
      expect(((await stored.json()) as { formFactor: string }).formFactor).toBe("till");
      expect(await screensOf(app, id)).toEqual(monitor);

      const accepted = await app.request(`/management-api/device-profiles/${id}`, {
        method: "PUT",
        headers: { ...JSON_HEADERS, cookie: managerCookie },
        body: JSON.stringify(
          asTill({ kitchenScreens: { pass: { stationIds: null, zoneIds: null } } }),
        ),
      });
      expect(accepted.status).toBe(200);
      expect(((await accepted.json()) as { formFactor: string }).formFactor).toBe("till");
      expect(await screensOf(app, id)).toEqual({ pass: { stationIds: null, zoneIds: null } });
    });

    it("refuses a kitchenScreens that is not a map of screens to lists", async () => {
      const app = mountApp();
      for (const kitchenScreens of [
        "station",
        null,
        [],
        { nope: { stationIds: null, zoneIds: null } },
        { station: null },
        { station: { stationIds: ["bad"], zoneIds: null } },
        { pass: { stationIds: null, zoneIds: "bad" } },
      ]) {
        const res = await app.request("/management-api/device-profiles", {
          method: "POST",
          headers: { ...JSON_HEADERS, cookie: managerCookie },
          body: JSON.stringify(kitchen(uniqueName("Bad screens"), { kitchenScreens })),
        });
        expect({ kitchenScreens, status: res.status, body: await res.json() }).toEqual({
          kitchenScreens,
          status: 400,
          body: {
            error: { code: "management.request_invalid", params: { field: "kitchenScreens" } },
          },
        });
      }
    });

    it("refuses the kitchen screens to a staff session", async () => {
      const app = mountApp();
      const staffCookie = await login(app, STAFF_EMAIL);
      const res = await app.request("/management-api/device-profile-kitchen-screens", {
        headers: { cookie: staffCookie },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    });

    it("no longer serves the station and watcher lists", async () => {
      const app = mountApp();
      const res = await app.request("/management-api/device-profile-kitchen-lists", {
        headers: { cookie: managerCookie },
      });
      expect(res.status).toBe(404);
    });
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

describe("Management API — a device profile's home layouts", () => {
  it("no longer serves a profile's home layout routes", async () => {
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);
    const created = await app.request("/management-api/device-profiles", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie },
      body: JSON.stringify({
        name: uniqueName("Handheld"),
        formFactor: "phone-portrait",
        ...ordering,
        canvasId: null,
        capabilities: [],
      }),
    });
    expect(created.status).toBe(201);
    const profile = ((await created.json()) as ProfileRow).id;
    const menuId = await withTransaction(
      suite.db,
      async (tx) => (await createCatalogue(tx, { name: uniqueName("Menu") })).id,
    );
    const path = `/management-api/device-profiles/${profile}/home-layouts`;
    const listed = await app.request(path, { headers: { cookie } });
    expect(listed.status).toBe(404);
    const saved = await app.request(`${path}/${menuId}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie },
      body: JSON.stringify({ layoutId: null }),
    });
    expect(saved.status).toBe(404);
  });
});

describe("Management API — who and where a device profile serves (W97)", () => {
  type Detail = ProfileRow & {
    startingScreen: string | null;
    departmentId: string | null;
    allowedZoneIds: string[] | null;
    startingZoneId: string | null;
    admittedRoles: string[];
    personExceptions: { personId: string; admitted: boolean }[];
  };
  const EVERY_ROLE = ["staff", "supervisor", "manager", "admin"];

  let cookie: string;
  /** A second zone of the counter's department, and a department of its own with one zone. */
  let place: { terrace: string; deli: string; deliCounter: string };
  let clerk: string;

  beforeAll(async () => {
    await setupTenantOnce();
    cookie = await login(mountApp(), MANAGER_EMAIL);
    place = await withTransaction(suite.db, async (tx) => {
      const terrace = await createServiceZone(tx, venueCfg, {
        name: uniqueName("Terrace"),
        departmentId: ordering.departmentId,
      });
      const deli = await createDepartment(tx, venueCfg, {
        name: uniqueName("Deli"),
        defaultServiceMode: "prepay",
      });
      const deliCounter = await createServiceZone(tx, venueCfg, {
        name: uniqueName("Deli counter"),
        departmentId: deli.id,
      });
      return { terrace: terrace.id, deli: deli.id, deliCounter: deliCounter.id };
    });
    const [person] = await suite.db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.email, STAFF_EMAIL));
    clerk = person!.id;
  });

  async function send(
    method: "POST" | "PUT",
    body: Record<string, unknown>,
    id?: string,
  ): Promise<{ status: number; body: unknown }> {
    const res = await mountApp().request(
      id === undefined
        ? "/management-api/device-profiles"
        : `/management-api/device-profiles/${id}`,
      { method, headers: { ...JSON_HEADERS, cookie }, body: JSON.stringify(body) },
    );
    return { status: res.status, body: await res.json() };
  }

  async function read(id: string): Promise<Detail> {
    const res = await mountApp().request(`/management-api/device-profiles/${id}`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as Detail;
  }

  async function listed(id: string): Promise<Detail | undefined> {
    const res = await mountApp().request("/management-api/device-profiles", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const { deviceProfiles } = (await res.json()) as { deviceProfiles: Detail[] };
    return deviceProfiles.find((profile) => profile.id === id);
  }

  const handheld = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    formFactor: "phone-portrait",
    canvasId: null,
    capabilities: ["take-orders", "take-cash", "show-schedule"],
    ...extra,
  });

  it("stores and reads back where an ordering profile serves, who signs in, its actions, screens and starting screen", async () => {
    const name = uniqueName("Terrace handheld");
    const created = await send(
      "POST",
      handheld(name, {
        departmentId: ordering.departmentId,
        allowedZoneIds: [place.terrace],
        startingZoneId: place.terrace,
        admittedRoles: ["staff", "supervisor"],
        personExceptions: [{ personId: clerk, admitted: false }],
        startingScreen: "show-schedule",
      }),
    );
    expect(created.status).toBe(201);
    const id = (created.body as Detail).id;
    const expected: Detail = {
      id,
      name,
      formFactor: "phone-portrait",
      canvasId: null,
      capabilities: ["take-orders", "take-cash", "show-schedule"],
      inactivityTimeoutSeconds: null,
      startingScreen: "show-schedule",
      receiptPrinterIds: [],
      paymentSlipPrinterIds: [],
      cashDrawerPrinterIds: [],
      receiptPrinterDefaultId: null,
      paymentSlipPrinterDefaultId: null,
      cashDrawerPrinterDefaultId: null,
      departmentId: ordering.departmentId,
      allowedZoneIds: [place.terrace],
      startingZoneId: place.terrace,
      admittedRoles: ["staff", "supervisor"],
      personExceptions: [{ personId: clerk, admitted: false }],
    };
    expect(created.body).toEqual(expected);
    expect(await read(id)).toEqual(expected);
    expect(await listed(id)).toEqual(expected);
  });

  it("replaces them with a PUT, and a PUT that names none of them keeps them", async () => {
    const name = uniqueName("Replaced");
    const created = await send(
      "POST",
      handheld(name, {
        ...ordering,
        admittedRoles: ["staff"],
        personExceptions: [{ personId: clerk, admitted: true }],
        startingScreen: "show-schedule",
      }),
    );
    const id = (created.body as Detail).id;
    const replaced = await send(
      "PUT",
      handheld(name, {
        capabilities: ["take-orders", "show-expo"],
        departmentId: place.deli,
        startingZoneId: place.deliCounter,
        admittedRoles: ["manager", "admin"],
        personExceptions: [],
        startingScreen: "show-expo",
      }),
      id,
    );
    expect(replaced.status).toBe(200);
    const after = {
      capabilities: ["take-orders", "show-expo"],
      startingScreen: "show-expo",
      departmentId: place.deli,
      allowedZoneIds: null,
      startingZoneId: place.deliCounter,
      admittedRoles: ["manager", "admin"],
      personExceptions: [],
    };
    expect(await read(id)).toMatchObject(after);

    const kept = await send(
      "PUT",
      handheld(name, { capabilities: ["take-orders", "show-expo"] }),
      id,
    );
    expect(kept.status).toBe(200);
    expect(await read(id)).toMatchObject(after);
  });

  it("takes an omitted zone list, role set, exception list and starting screen as every zone, every role, none and none, and an explicit null the same", async () => {
    for (const extra of [{}, { allowedZoneIds: null, startingScreen: null }]) {
      const created = await send(
        "POST",
        handheld(uniqueName("Defaults"), { ...ordering, ...extra }),
      );
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        departmentId: ordering.departmentId,
        allowedZoneIds: null,
        startingZoneId: ordering.startingZoneId,
        admittedRoles: EVERY_ROLE,
        personExceptions: [],
        startingScreen: null,
      });
    }
  });

  it("keeps each scope field a PUT omits, and widens to every zone only on an explicit null", async () => {
    const name = uniqueName("Terrace only");
    const created = await send(
      "POST",
      handheld(name, {
        departmentId: ordering.departmentId,
        allowedZoneIds: [place.terrace],
        startingZoneId: place.terrace,
      }),
    );
    const id = (created.body as Detail).id;
    const narrowed = {
      departmentId: ordering.departmentId,
      allowedZoneIds: [place.terrace],
      startingZoneId: place.terrace,
    };
    for (const partial of [
      { departmentId: ordering.departmentId, startingZoneId: place.terrace },
      { startingZoneId: place.terrace },
      { departmentId: ordering.departmentId },
    ]) {
      const res = await send("PUT", handheld(name, partial), id);
      expect({ partial, status: res.status }).toEqual({ partial, status: 200 });
      expect(await read(id)).toMatchObject(narrowed);
    }
    await send("PUT", handheld(name, { allowedZoneIds: null }), id);
    expect(await read(id)).toMatchObject({ ...narrowed, allowedZoneIds: null });
  });

  it("refuses a PUT that moves a narrowed profile to another department without naming its zones, and keeps what was stored", async () => {
    const name = uniqueName("Moved department");
    const created = await send(
      "POST",
      handheld(name, {
        departmentId: ordering.departmentId,
        allowedZoneIds: [place.terrace],
        startingZoneId: place.terrace,
      }),
    );
    const id = (created.body as Detail).id;
    const before = await read(id);

    const res = await send(
      "PUT",
      handheld(name, { departmentId: place.deli, startingZoneId: place.deliCounter }),
      id,
    );

    expect(res).toEqual({
      status: 400,
      body: {
        error: {
          code: "device_profile.access_invalid",
          params: expect.objectContaining({ field: "allowedZoneIds" }),
        },
      },
    });
    expect(await read(id)).toEqual(before);
  });

  it("keeps a starting screen a PUT omits, and clears it on an explicit null", async () => {
    const name = uniqueName("Start screen");
    const created = await send(
      "POST",
      handheld(name, { ...ordering, startingScreen: "show-schedule" }),
    );
    const id = (created.body as Detail).id;
    await send("PUT", handheld(name), id);
    expect((await read(id)).startingScreen).toBe("show-schedule");
    await send("PUT", handheld(name, { startingScreen: null }), id);
    expect((await read(id)).startingScreen).toBeNull();
  });

  it("refuses a profile that takes orders without a department, omitted or null, naming the field", async () => {
    for (const extra of [
      {},
      { departmentId: null },
      { departmentId: null, startingZoneId: null },
    ]) {
      const name = uniqueName("No department");
      expect(await send("POST", handheld(name, extra))).toEqual({
        status: 400,
        body: {
          error: {
            code: "device_profile.access_invalid",
            params: { field: "departmentId", reason: "required" },
          },
        },
      });
      const res = await mountApp().request("/management-api/device-profiles", {
        headers: { cookie },
      });
      const { deviceProfiles } = (await res.json()) as { deviceProfiles: Detail[] };
      expect(deviceProfiles.some((profile) => profile.name === name)).toBe(false);
    }
    const created = await send("POST", handheld(uniqueName("Had one"), ordering));
    const id = (created.body as Detail).id;
    expect(await send("PUT", handheld(uniqueName("Lost it"), { departmentId: null }), id)).toEqual({
      status: 400,
      body: {
        error: {
          code: "device_profile.access_invalid",
          params: { field: "departmentId", reason: "required" },
        },
      },
    });
    expect((await read(id)).departmentId).toBe(ordering.departmentId);
  });

  it("refuses an unknown department, a zone of another department and an unknown person, naming the field, and leaves the stored profile as it was", async () => {
    const name = uniqueName("Kept policy");
    const created = await send(
      "POST",
      handheld(name, {
        ...ordering,
        admittedRoles: ["staff"],
        personExceptions: [{ personId: clerk, admitted: true }],
      }),
    );
    const id = (created.body as Detail).id;
    const before = await read(id);
    const refusals = [
      [
        { departmentId: randomUUID(), startingZoneId: place.terrace },
        "device_profile.access_invalid",
        { field: "departmentId", reason: "not_found" },
      ],
      [
        { ...ordering, allowedZoneIds: [ordering.startingZoneId, place.deliCounter] },
        "device_profile.access_invalid",
        { field: "allowedZoneIds", reason: "outside_department" },
      ],
      [
        { departmentId: ordering.departmentId, startingZoneId: place.deliCounter },
        "device_profile.access_invalid",
        { field: "startingZoneId", reason: "outside_department" },
      ],
      [
        {
          departmentId: place.deli,
          startingZoneId: place.deliCounter,
          personExceptions: [{ personId: randomUUID(), admitted: true }],
        },
        "device_profile.admission_invalid",
        { field: "personExceptions", reason: "not_found" },
      ],
      [
        { departmentId: place.deli, startingZoneId: place.deliCounter, admittedRoles: [] },
        "device_profile.admission_invalid",
        { field: "admittedRoles", reason: "empty" },
      ],
    ] as const;
    for (const [extra, code, params] of refusals) {
      const res = await send(
        "PUT",
        handheld(uniqueName("Refused"), { capabilities: ["take-orders"], ...extra }),
        id,
      );
      expect({ extra, ...res }).toEqual({
        extra,
        status: 400,
        body: { error: { code, params: expect.objectContaining(params) } },
      });
      expect(await read(id)).toEqual(before);
    }
  });

  it("refuses a malformed scope, role set, exception list or starting screen, naming the field", async () => {
    const twice = randomUUID();
    const cases = [
      ["departmentId", { departmentId: "not-a-uuid", startingZoneId: ordering.startingZoneId }],
      ["departmentId", { departmentId: 7, startingZoneId: ordering.startingZoneId }],
      ["allowedZoneIds", { ...ordering, allowedZoneIds: "every" }],
      ["allowedZoneIds", { ...ordering, allowedZoneIds: [twice, twice] }],
      ["startingZoneId", { departmentId: ordering.departmentId, startingZoneId: ["x"] }],
      ["admittedRoles", { ...ordering, admittedRoles: "staff" }],
      ["admittedRoles", { ...ordering, admittedRoles: ["chef"] }],
      ["admittedRoles", { ...ordering, admittedRoles: ["staff", "staff"] }],
      ["admittedRoles", { ...ordering, admittedRoles: null }],
      ["personExceptions", { ...ordering, personExceptions: null }],
      ["personExceptions", { ...ordering, personExceptions: [{ personId: "x", admitted: true }] }],
      [
        "personExceptions",
        { ...ordering, personExceptions: [{ personId: clerk, admitted: "yes" }] },
      ],
      [
        "personExceptions",
        {
          ...ordering,
          personExceptions: [
            { personId: clerk, admitted: true },
            { personId: clerk, admitted: false },
          ],
        },
      ],
    ] as const;
    for (const [field, extra] of cases) {
      expect({ field, ...(await send("POST", handheld(uniqueName("Bad"), extra))) }).toEqual({
        field,
        status: 400,
        body: { error: { code: "management.request_invalid", params: { field } } },
      });
    }
    expect(
      await send(
        "POST",
        handheld(uniqueName("Bad start"), { ...ordering, startingScreen: "show-expo" }),
      ),
    ).toEqual({
      status: 400,
      body: {
        error: { code: "device_profile.invalid", params: { reason: "bad_starting_screen" } },
      },
    });
  });

  it("refuses a kitchen display payment and drawer actions and a department, and stores none", async () => {
    for (const action of [
      "take-cash",
      "integrated-card-payment",
      "hand-keyed-card-payment",
      "open-cash-drawer",
    ]) {
      expect({
        action,
        ...(await send("POST", {
          name: uniqueName("Kitchen"),
          formFactor: "kds",
          canvasId: null,
          capabilities: ["act-as-kds", action],
        })),
      }).toEqual({
        action,
        status: 400,
        body: {
          error: { code: "device_profile.invalid", params: { reason: "shared_display_action" } },
        },
      });
    }
    const taking = await send("POST", {
      name: uniqueName("Kitchen pass"),
      formFactor: "kds",
      canvasId: null,
      capabilities: ["act-as-kds", "take-orders", "hand-over-orders"],
    });
    expect(taking.status).toBe(201);
    expect(taking.body).toMatchObject({
      capabilities: ["act-as-kds", "take-orders", "hand-over-orders"],
    });
    const kitchen = {
      formFactor: "kds",
      canvasId: null,
      capabilities: ["act-as-kds", "prepare-orders"],
    };
    expect(await send("POST", { ...kitchen, name: uniqueName("Kitchen"), ...ordering })).toEqual({
      status: 400,
      body: {
        error: {
          code: "device_profile.access_invalid",
          params: { field: "departmentId", reason: "shared_display" },
        },
      },
    });
    const created = await send("POST", { ...kitchen, name: uniqueName("Kitchen") });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      departmentId: null,
      allowedZoneIds: null,
      startingZoneId: null,
    });
  });

  it("drops a profile's department when a PUT makes it a kitchen display", async () => {
    const name = uniqueName("Becomes kitchen");
    const created = await send("POST", handheld(name, ordering));
    const id = (created.body as Detail).id;
    const res = await send(
      "PUT",
      { name, formFactor: "kds", canvasId: null, capabilities: ["act-as-kds"] },
      id,
    );
    expect(res.status).toBe(200);
    expect(await read(id)).toMatchObject({
      formFactor: "kds",
      departmentId: null,
      allowedZoneIds: null,
      startingZoneId: null,
    });
  });

  it("reads back a zone switched off since it was chosen, so the manager sees what is stored", async () => {
    const spare = await withTransaction(suite.db, (tx) =>
      createServiceZone(tx, venueCfg, {
        name: uniqueName("Spare"),
        departmentId: ordering.departmentId,
      }),
    );
    const created = await send(
      "POST",
      handheld(uniqueName("Spare zone"), {
        ...ordering,
        allowedZoneIds: [ordering.startingZoneId, spare.id],
      }),
    );
    const id = (created.body as Detail).id;
    await withTransaction(suite.db, (tx) => deactivateServiceZone(tx, venueCfg, spare.id));
    expect((await read(id)).allowedZoneIds).toEqual(
      expect.arrayContaining([ordering.startingZoneId, spare.id]),
    );
  });
});
