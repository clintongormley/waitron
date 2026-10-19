import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";

/**
 * The dashboard no longer serves venue-made table statuses: every `/management-api/service-statuses`
 * method answers the router's plain 404. `setupTenant` is shared with other suites.
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
  return `${String(72_000_000 + nifCounter).padStart(8, "0")}K`;
}

export async function setupTenant(): Promise<{ managerId: string; staffId: string }> {
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

  // Through the table definition: `persons.id` and `persons.created_at` are `$defaultFn`
  // generators, which a raw SQL insert never reaches.
  const { managerId, staffId } = await withTransaction(suite.db, async (tx) => {
    const seed = async (displayName: string, email: string, role: "manager" | "staff") => {
      const [person] = await tx
        .insert(persons)
        .values({
          displayName,
          email,
          pinHash: hashPin("1234"),
          passwordHash: hashPassword(PASSWORD),
          role,
        })
        .returning({ id: persons.id });
      return person!.id;
    };
    return {
      managerId: await seed("The Manager", MANAGER_EMAIL, "manager"),
      staffId: await seed("The Clerk", STAFF_EMAIL, "staff"),
    };
  });
  return { managerId, staffId };
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

let app: Hono;
let managerCookie: string;
const json = { "content-type": "application/json" };

beforeAll(async () => {
  await setupTenant();
  app = mountApp();
  managerCookie = await login(app, MANAGER_EMAIL);
});

async function request(path: string, init: RequestInit, cookie?: string): Promise<Response> {
  return app.request(`/management-api/service-statuses${path}`, {
    ...init,
    headers: { ...json, ...(cookie ? { cookie } : {}), ...init.headers },
  });
}

describe("/management-api/service-statuses", () => {
  it("no longer serves /management-api/service-statuses", async () => {
    expect((await request("", { method: "GET" }, managerCookie)).status).toBe(404);
    expect(
      (
        await request(
          "",
          { method: "POST", body: JSON.stringify({ label: "x", color: "#000" }) },
          managerCookie,
        )
      ).status,
    ).toBe(404);

    const patch = await request(
      `/${randomUUID()}`,
      { method: "PATCH", body: JSON.stringify({ label: "x" }) },
      managerCookie,
    );
    expect(patch.status).toBe(404);
    expect(await patch.text()).not.toContain("status.not_found");

    const del = await request(`/${randomUUID()}`, { method: "DELETE" }, managerCookie);
    expect(del.status).toBe(404);
    expect(await del.text()).not.toContain("status.not_found");
  });
});
