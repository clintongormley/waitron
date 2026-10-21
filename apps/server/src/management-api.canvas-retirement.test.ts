import { eq } from "drizzle-orm";
import { LiveEvents, changeSubscriber, mountLiveApi } from "./live-api.js";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import {
  deviceProfiles,
  installChangeFeed,
  subscribeToChanges,
  withTransaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountManagementApi } from "./management-api.js";
import { mountThemesApi } from "./themes-api.js";
import { ALL_MODULES } from "./modules.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";

/**
 * The theme and retired canvas routes over HTTP, with the manager and staff
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
      credentialKeyRing: TOTP_KEY_RING,
    },
    noopLog,
  );
  mountThemesApi(app, { db: suite.db }, noopLog);
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

describe("Management API — custom themes", () => {
  const RED = {
    brandColor: "#ff0000",
    brandFix: {},
    background: "neutral",
    corners: "standard",
    handSet: { light: {}, dark: {} },
  };
  let managerCookie: string;
  let redId: string;

  beforeAll(async () => {
    await setupTenant();
    managerCookie = await login(mountApp(), MANAGER_EMAIL);
  });

  it("GET lists no custom themes and none in use for a venue that has saved none", async () => {
    const app = mountApp();
    const res = await app.request("/management-api/themes", {
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ themes: [], inUse: null });
  });

  it("POST → 201, then GET lists it (round trip)", async () => {
    const app = mountApp();
    const post = await app.request("/management-api/themes", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({ name: "Red", theme: RED }),
    });
    expect(post.status).toBe(201);
    const created = (await post.json()) as { id: string; name: string; choices: unknown };
    expect(created).toMatchObject({ name: "Red", choices: RED });
    redId = created.id;

    const got = await app.request("/management-api/themes", {
      headers: { cookie: managerCookie },
    });
    expect(got.status).toBe(200);
    const { themes } = (await got.json()) as { themes: Record<string, unknown>[] };
    expect(themes).toHaveLength(1);
    expect(themes[0]).toMatchObject({ id: redId, name: "Red", choices: RED });
  });

  it("PUT with an unknown colour → 400 theme.invalid naming the field", async () => {
    const app = mountApp();
    const res = await app.request(`/management-api/themes/${redId}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: managerCookie },
      body: JSON.stringify({
        theme: { ...RED, handSet: { light: { evil: "#ff0000" }, dark: {} } },
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "theme.invalid",
        params: { field: "handSet.light", reason: "unknown_colour" },
      },
    });
  });

  it("PUT with a body omitting theme → 400 management.request_invalid naming the field", async () => {
    const app = mountApp();
    for (const body of [JSON.stringify({}), "null"]) {
      const res = await app.request(`/management-api/themes/${redId}`, {
        method: "PUT",
        headers: { ...JSON_HEADERS, cookie: managerCookie },
        body,
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "theme" } },
      });
    }
  });

  it("refuses the theme routes for a STAFF-role session with 403", async () => {
    const app = mountApp();
    const staffCookie = await login(app, STAFF_EMAIL);
    for (const res of [
      await app.request("/management-api/themes", { headers: { cookie: staffCookie } }),
      await app.request(`/management-api/themes/${redId}`, {
        method: "PUT",
        headers: { ...JSON_HEADERS, cookie: staffCookie },
        body: JSON.stringify({ theme: RED }),
      }),
    ]) {
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "authorization.not_permitted",
      );
    }
  });

  it("refuses the theme routes unauthenticated with 401", async () => {
    const app = mountApp();
    const res = await app.request("/management-api/themes");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "management_session.required",
    );
  });
});

describe("A182 canvas retirement", () => {
  it("answers retired canvas routes like an unknown route while profiles remain available", async () => {
    await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);
    for (const [path, method] of [
      ["/management-api/canvases", "GET"],
      ["/management-api/canvases", "POST"],
      ["/management-api/canvases/00000000-0000-4000-8000-000000000001", "GET"],
      ["/management-api/canvases/00000000-0000-4000-8000-000000000001", "PUT"],
      ["/management-api/canvases/00000000-0000-4000-8000-000000000001", "DELETE"],
    ] as const) {
      const init = {
        method,
        headers: { ...JSON_HEADERS, cookie },
        ...(method === "POST" || method === "PUT" ? { body: "{}" } : {}),
      };
      const missing = await app.request("/management-api/unknown-retired-resource", init);
      const retired = await app.request(path, init);
      expect({ status: retired.status, body: await retired.text() }).toEqual({
        status: missing.status,
        body: await missing.text(),
      });
    }
    const profiles = await app.request("/management-api/device-profiles", { headers: { cookie } });
    expect(profiles.status).toBe(200);
    const body = (await profiles.json()) as { deviceProfiles: Record<string, unknown>[] };
    expect(body.deviceProfiles.length).toBeGreaterThan(0);
    for (const profile of body.deviceProfiles) expect(profile).not.toHaveProperty("canvasId");
  });
});

it("streams a retained profile change while refusing the retired canvas subscription", async () => {
  await setupTenant();
  const app = mountApp();
  const sources = ALL_MODULES.flatMap((module) => module.changes ?? []);
  await installChangeFeed(suite.db, sources);
  const bus = new LiveEvents();
  const unsubscribe = subscribeToChanges(changeSubscriber(bus, noopLog));
  mountLiveApi(
    app,
    { db: suite.db, bus, resourceTypes: sources.map((source) => source.type) },
    noopLog,
  );
  const cookie = await login(app, MANAGER_EMAIL);
  const [profile] = await suite.db.select().from(deviceProfiles);
  const interests = encodeURIComponent(
    JSON.stringify([{ type: "device_profiles", id: profile!.id }]),
  );
  const response = await app.request(`/management-api/events?resources=${interests}`, {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  try {
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: ready");
    await withTransaction(suite.db, async (tx) => {
      await tx
        .update(deviceProfiles)
        .set({ name: "Updated fixed screen profile" })
        .where(eq(deviceProfiles.id, profile!.id));
    });
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      `event: change\ndata: [{"type":"device_profiles","id":"${profile!.id}"}]\n\n`,
    );
    const retired = await app.request(
      `/management-api/events?resources=${encodeURIComponent('[{"type":"canvases"}]')}`,
      { headers: { cookie } },
    );
    expect(retired.status).toBe(400);
  } finally {
    await reader.cancel();
    unsubscribe();
    bus.close();
  }
});
