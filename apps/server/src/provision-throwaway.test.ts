import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCountryPack } from "@waitron/country-packs";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { parseModuleConfig } from "@waitron/module";
import type { InitialVenueInput, VenueRequest } from "@waitron/provisioning";
import { ALL_MODULES } from "./modules.js";
import { provisionVenue, venueModuleConfig, type ProvisionRequest } from "./provision.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const ALL_ENABLED = parseModuleConfig({}, ALL_MODULES);
const ES_CONFIG = venueModuleConfig(ALL_ENABLED, "ES-common");

let stateDir: string;
beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "waitron-provision-throwaway-"));
});
afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

function venue(
  identity: { taxId: string; legalName: string },
  territory: { country: string; fiscalTerritory: string } = {
    country: "ES",
    fiscalTerritory: "ES-common",
  },
): VenueRequest {
  return {
    country: territory.country,
    ...identity,
    location: {
      name: "Casa Real",
      fiscalTerritory: territory.fiscalTerritory,
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
    fullSeriesCode: "FF",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Admin",
      pinHash: "pin-hash",
      passwordHash: "password-hash",
      email: "admin@example.test",
    },
  };
}

const real = { taxId: "B12345674", legalName: "Real Restaurant S.L." };
const santet = { taxId: getCountryPack("ES")!.demo!.taxId, legalName: "SANTET DELI CO S.L." };

function facts() {
  return {
    tenant: suite.db.all(sql`select * from tenants`),
    deployment: suite.db.all(sql`select * from deployment`),
    allocations: suite.db.all(sql`select * from fiscal_allocations`),
    sif: suite.db.all(sql`select * from registro_sif`),
    series: suite.db.all(sql`select * from invoice_series`),
  };
}

function provision(req: ProvisionRequest, moduleConfig = ES_CONFIG) {
  return provisionVenue({ ownerDb: suite.db, moduleConfig, database: "waitron", stateDir }, req);
}

const throwaway = (hostEnvironment: "production" | "preproduction") =>
  ({ kind: "throwaway", hostEnvironment }) as const;

describe("provisionVenue with a throwaway allocation", () => {
  it.each([real, santet])(
    "provisions a preproduction venue with its own allocation: %j",
    async (identity) => {
      const result = await provision({
        environment: "preproduction",
        venue: venue(identity),
        initialAllocation: throwaway("preproduction"),
      });

      expect(suite.db.all(sql`select numero_instalacion, node_id from registro_sif`)).toEqual([
        { numero_instalacion: "S000001", node_id: result.nodeId },
      ]);
      expect(suite.db.all(sql`select taxpayer_nif, environment from fiscal_allocations`)).toEqual([
        { taxpayer_nif: identity.taxId, environment: "preproduction" },
      ]);
      expect(suite.db.all(sql`select code, purpose from invoice_series order by code`)).toEqual([
        { code: "A-S000001", purpose: "standard" },
        { code: "FF-S000001", purpose: "full" },
        { code: "R-S000001", purpose: "rectificative" },
      ]);
      expect(suite.db.all(sql`select tax_id, legal_name from tenants`)).toEqual([
        { tax_id: identity.taxId, legal_name: identity.legalName },
      ]);
      expect(suite.db.all(sql`select environment from deployment`)).toEqual([
        { environment: "preproduction" },
      ]);
    },
  );

  // provisionVenue cannot tell Demo from Preparation: both reach it as a preproduction request.
  it.each(["demo", "prepare"])(
    "refuses a %s setup on a production box before writing anything",
    async () => {
      const before = facts();
      await expect(
        provision({
          environment: "preproduction",
          venue: venue(real),
          initialAllocation: throwaway("production"),
        }),
      ).rejects.toMatchObject({
        code: "sif.throwaway_allocation_refused",
        params: { environment: "production" },
      });
      expect(facts()).toEqual(before);
      expect(before.deployment).toEqual([]);
    },
  );

  it("refuses a production request before writing anything", async () => {
    const before = facts();
    await expect(
      provision({
        environment: "production",
        venue: venue(real),
        initialAllocation: throwaway("preproduction"),
      }),
    ).rejects.toMatchObject({
      code: "sif.throwaway_allocation_refused",
      params: { environment: "production" },
    });
    expect(facts()).toEqual(before);
  });

  it("refuses a request carrying both a throwaway marker and supplied operations", async () => {
    const before = facts();
    await expect(
      provision({
        environment: "preproduction",
        venue: venue(real),
        initialAllocation: throwaway("preproduction"),
        initialOperations: {
          nodeId: randomUUID(),
          administratorId: randomUUID(),
          inputs: [{ module: "fiscal-verifactu", eventId: "event", sourceId: "source", input: {} }],
        } satisfies InitialVenueInput,
      }),
    ).rejects.toMatchObject({
      code: "setup.request_invalid",
      params: { field: "initialOperations" },
    });
    expect(facts()).toEqual(before);
  });

  // No country pack offers a territory whose fiscal slot is fiscal-none today; GB-vat is the one
  // venueModuleConfig resolves to it, as provision.test.ts's no-regime case uses.
  it("provisions a venue whose territory has no throwaway allocation, with no allocation", async () => {
    const result = await provision(
      {
        environment: "preproduction",
        venue: venue(real, { country: "GB", fiscalTerritory: "GB-vat" }),
        initialAllocation: throwaway("preproduction"),
      },
      venueModuleConfig(ALL_ENABLED, "GB-vat"),
    );

    expect(result.seriesIds).toHaveLength(3);
    expect(suite.db.all(sql`select * from fiscal_allocations`)).toEqual([]);
    expect(suite.db.all(sql`select * from registro_sif`)).toEqual([]);
    expect(suite.db.all(sql`select tax_id from tenants`)).toEqual([{ tax_id: real.taxId }]);
  });

  it("leaves the shipped module list's fiscal evidence source untouched", async () => {
    const fiscal = () => ALL_MODULES.find((module) => module.name === "fiscal-verifactu")!;
    const shipped = fiscal();
    const operations = shipped.operations;
    await provision({
      environment: "preproduction",
      venue: venue(real),
      initialAllocation: throwaway("preproduction"),
    });
    expect(fiscal()).toBe(shipped);
    expect(fiscal().operations).toBe(operations);
  });
});
