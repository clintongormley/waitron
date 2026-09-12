import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { startManagementSession } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyVenue, planVenue, type VenueRequest, type VenueResult } from "@waitron/provisioning";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { schemaVersionsByModule } from "./backup-manifest.js";
import { mountConfigurationExportApi } from "./configuration-export-api.js";
import { decodeConfigurationBundle } from "./configuration-transfer.js";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";

const noopLog: Logger = () => {};
let venue: VenueResult;
let cookie: string;
let foreignCookie: string;
let moduleVersions: Record<string, number>;

const request: VenueRequest = {
  country: "ES",
  taxId: "B44444444",
  legalName: "Prepared Export SL",
  location: {
    name: "Prepared",
    invoiceLocales: ["es-ES"],
    operationDescription: "Restaurant",
    fiscalTerritory: "ES-common",
    addressLine1: "Calle 1",
    addressLine2: null,
    postalCode: "28001",
    city: "Madrid",
    province: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "06:00",
  },
  tillName: "Till",
  seriesCode: "F",
  rectificativeSeriesCode: "R",
  admin: {
    displayName: "Admin",
    email: "export@example.test",
    pinHash: "pin",
    passwordHash: "password",
  },
};

const suite = usePgliteDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    venue = await applyVenue(planVenue(request, ALL_MODULES), { db, modules: ALL_MODULES });
    moduleVersions = await schemaVersionsByModule(db, ALL_MODULES);
    cookie = await withTenant(db, venue.tenantId, async (tx) => {
      await asAppUser(tx);
      const admin = await tx.execute<{ id: string }>(sql`
        select id from persons where tenant_id = ${venue.tenantId} and role = 'admin'
      `);
      const session = await startManagementSession(tx, {
        tenantId: venue.tenantId,
        personId: admin.rows[0]!.id,
      });
      return `${MANAGEMENT_COOKIE}=${session.id}`;
    });
    const foreignVenue = await applyVenue(
      planVenue(
        {
          ...request,
          taxId: "B55555555",
          legalName: "Other Tenant SL",
          admin: { ...request.admin, email: "other@example.test" },
        },
        ALL_MODULES,
      ),
      { db, modules: ALL_MODULES },
    );
    foreignCookie = await withTenant(db, foreignVenue.tenantId, async (tx) => {
      await asAppUser(tx);
      const admin = await tx.execute<{ id: string }>(sql`
        select id from persons where tenant_id = ${foreignVenue.tenantId} and role = 'admin'
      `);
      const session = await startManagementSession(tx, {
        tenantId: foreignVenue.tenantId,
        personId: admin.rows[0]!.id,
      });
      return `${MANAGEMENT_COOKIE}=${session.id}`;
    });
  },
});

function app(): Hono {
  const app = new Hono();
  mountConfigurationExportApi(
    app,
    {
      db: suite.db,
      cfg: venue,
      modules: ALL_MODULES,
      moduleVersions,
      now: () => new Date("2026-09-09T00:00:00.000Z"),
    },
    noopLog,
  );
  return app;
}

describe("configuration export API", () => {
  it("requires an authenticated manager", async () => {
    const response = await app().request("/management-api/configuration-export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase: "a strong passphrase" }),
    });
    expect(response.status).toBe(401);
  });

  it("refuses a manager session belonging to another tenant", async () => {
    const response = await app().request("/management-api/configuration-export", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: foreignCookie },
      body: JSON.stringify({ passphrase: "a strong passphrase" }),
    });
    expect(response.status).toBe(403);
  });

  it("returns an encrypted configuration-only artifact", async () => {
    const response = await app().request("/management-api/configuration-export", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ passphrase: "a strong passphrase" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const decoded = decodeConfigurationBundle(
      new Uint8Array(await response.arrayBuffer()),
      "a strong passphrase",
    );
    expect(decoded.venue.legalName).toBe("Prepared Export SL");
    expect(decoded.tables).not.toHaveProperty("sales");
  });
});
