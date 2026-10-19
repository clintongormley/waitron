import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { planVenue, type VenueRequest } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";
import { applyDeveloperDemoVenue } from "./allocation.js";

beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-16T11:40:00Z"), toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

function request(changes: Partial<VenueRequest> = {}): VenueRequest {
  return {
    country: "ES",
    taxId: "B00000000",
    legalName: "Waitron Demo S.L.",
    location: {
      name: "Casa Delgado",
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
    fullSeriesCode: "FA",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Demo",
      pinHash: "demo-hash",
      passwordHash: "demo-password-hash",
      email: "demo@example.test",
    },
    ...changes,
  };
}

function facts() {
  return {
    tenant: suite.db.all(sql`select * from tenants`),
    deployment: suite.db.all(sql`select * from deployment`),
    allocations: suite.db.all(sql`select * from fiscal_allocations`),
    sif: suite.db.all(sql`select * from registro_sif`),
    series: suite.db.all(sql`select * from invoice_series`),
  };
}

describe("developer allocation boundary", () => {
  it.each([{}, { WAITRON_ENV: "dev" }, { WAITRON_ENV: "preproduction" }])(
    "activates all purposes only for the fictional demo in %j",
    async (environment) => {
      const venue = await applyDeveloperDemoVenue(
        planVenue(request(), ALL_MODULES),
        { db: suite.db, modules: ALL_MODULES },
        environment,
      );
      expect(suite.db.all(sql`select code, purpose from invoice_series order by code`)).toEqual([
        { code: "A-06RB", purpose: "standard" },
        { code: "FA-06RB", purpose: "full" },
        { code: "R-06RB", purpose: "rectificative" },
      ]);
      expect(suite.db.all(sql`select numero_instalacion, node_id from registro_sif`)).toEqual([
        { numero_instalacion: "06RB", node_id: venue.nodeId },
      ]);
      expect(suite.db.all(sql`select taxpayer_nif, environment from fiscal_allocations`)).toEqual([
        { taxpayer_nif: "B00000000", environment: "preproduction" },
      ]);
    },
  );

  it("refuses production at the allocation boundary before writing any venue facts", async () => {
    const before = facts();
    await expect(
      applyDeveloperDemoVenue(
        planVenue(request(), ALL_MODULES),
        { db: suite.db, modules: ALL_MODULES },
        { WAITRON_ENV: "production" },
      ),
    ).rejects.toMatchObject({ code: "deployment.demo_data_refused" });
    expect(facts()).toEqual(before);
  });

  it.each([{ taxId: "B12345678" }, { legalName: "Real Restaurant S.L." }, { country: "FR" }])(
    "refuses a non-demo identity %j before writing venue facts",
    async (identity) => {
      const actions = planVenue(request(), ALL_MODULES).map((action) =>
        action.kind === "ensure-tenant" ? { ...action, ...identity } : action,
      );
      const before = facts();
      await expect(
        applyDeveloperDemoVenue(
          actions,
          { db: suite.db, modules: ALL_MODULES },
          { WAITRON_ENV: "dev" },
        ),
      ).rejects.toMatchObject({ code: "deployment.demo_data_refused" });
      expect(facts()).toEqual(before);
    },
  );
});
