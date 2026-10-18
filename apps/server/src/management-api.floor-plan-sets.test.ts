import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { floorPlanSets, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import { locationId, nodeId } from "@waitron/shared";
import { createDepartment, createServiceZone, linkFloorPlanSet } from "@waitron/venue-service";
import type { Logger } from "./logger.js";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import type { TillConfig } from "./till-config.js";

const PASSWORD = "correct horse";
const MANAGER_EMAIL = "manager@x.com";
const STAFF_EMAIL = "clerk@x.com";
const PLACE = { x: 0, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 };

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

const noopLog: Logger = () => {};

async function provisionTenant(): Promise<TillConfig> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: "75000001K",
        legalName: "Deli Test SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: ["es-ES"],
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
  return {
    nodeId: nodeId(venue.nodeId),
    locationId: locationId(venue.locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
}

/** A department with one zone and one set. */
async function setAndZone(): Promise<{ setId: string; zoneId: string }> {
  return withTransaction(suite.db, async (tx) => {
    const dept = await createDepartment(tx, cfg, {
      name: `Dept-${randomUUID().slice(0, 6)}`,
      orderStart: "table",
    });
    const zone = await createServiceZone(tx, cfg, {
      name: `Inside-${randomUUID().slice(0, 6)}`,
      departmentId: dept.id,
    });
    const [set] = await tx
      .insert(floorPlanSets)
      .values({ locationId: cfg.locationId })
      .returning({ id: floorPlanSets.id });
    await linkFloorPlanSet(tx, cfg, { setId: set!.id, departmentId: dept.id, name: "Dinner" });
    return { setId: set!.id, zoneId: zone.id };
  });
}

let app: Hono;
let cfg: TillConfig;
let managerCookie: string;
let staffCookie: string;

async function login(email: string): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

beforeAll(async () => {
  cfg = await provisionTenant();
  app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: cfg.nodeId },
      venueCfg: cfg,
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
      credentialKeyRing: TOTP_KEY_RING,
    },
    noopLog,
  );
  managerCookie = await login(MANAGER_EMAIL);
  staffCookie = await login(STAFF_EMAIL);
});

function layout(at: { setId: string; zoneId: string }, init: RequestInit, cookie: string) {
  return app.request(`/management-api/floor-plan-sets/${at.setId}/zones/${at.zoneId}/floor-plan`, {
    ...init,
    headers: { "content-type": "application/json", cookie },
  });
}

describe("/management-api/floor-plan-sets/:setId/zones/:zoneId/floor-plan", () => {
  it("saves a set's layout and reads it back", async () => {
    const at = await setAndZone();
    const label = `T-${randomUUID().slice(0, 6)}`;
    const body = {
      revision: 0,
      tables: [{ key: "a", label, seats: 4, fixed: false, placement: PLACE, partKeys: [] }],
    };

    const put = await layout(at, { method: "PUT", body: JSON.stringify(body) }, managerCookie);
    expect(put.status).toBe(200);
    const { revision, ids } = (await put.json()) as {
      revision: number;
      ids: Record<string, string>;
    };
    expect(revision).toBe(1);

    const got = await layout(at, { method: "GET" }, managerCookie);
    expect(got.status).toBe(200);
    expect(await got.json()).toMatchObject({
      setId: at.setId,
      setName: "Dinner",
      zoneId: at.zoneId,
      revision: 1,
      tables: [{ id: ids.a, label, placement: PLACE }],
    });
  });

  it("refuses a set id that is not a UUID as an unknown set", async () => {
    const at = await setAndZone();
    const res = await layout({ ...at, setId: "not-a-uuid" }, { method: "GET" }, managerCookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "floor_plan_set.not_found", params: { setId: "not-a-uuid" } },
    });
  });

  it("no longer serves the zone-only floor plan routes", async () => {
    const at = await setAndZone();
    const res = await app.request(`/management-api/zones/${at.zoneId}/floor-plan`, {
      method: "GET",
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(404);
  });

  it("refuses a person without venue.configure on both routes", async () => {
    const at = await setAndZone();
    const body = JSON.stringify({ revision: 0, tables: [] });

    const get = await layout(at, { method: "GET" }, staffCookie);
    const put = await layout(at, { method: "PUT", body }, staffCookie);

    const refused = {
      error: { code: "authorization.not_permitted", params: { permission: "venue.configure" } },
    };
    expect(get.status).toBe(403);
    expect(await get.json()).toEqual(refused);
    expect(put.status).toBe(403);
    expect(await put.json()).toEqual(refused);
  });
});
