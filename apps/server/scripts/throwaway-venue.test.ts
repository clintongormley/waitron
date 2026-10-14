import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getCountryPack } from "@waitron/country-packs";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { planVenue, type VenueRequest } from "@waitron/provisioning";
import { ALL_MODULES } from "../src/modules.js";
import { applyDevelopmentVenue } from "./throwaway-venue.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

function request(identity: { taxId: string; legalName: string }): VenueRequest {
  return {
    country: "ES",
    ...identity,
    location: {
      name: "Casa Real",
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

function facts() {
  return {
    tenant: suite.db.all(sql`select * from tenants`),
    deployment: suite.db.all(sql`select * from deployment`),
    allocations: suite.db.all(sql`select * from fiscal_allocations`),
    sif: suite.db.all(sql`select * from registro_sif`),
    series: suite.db.all(sql`select * from invoice_series`),
  };
}

const real = { taxId: "B12345674", legalName: "Real Restaurant S.L." };
const santet = { taxId: getCountryPack("ES")!.demo!.taxId, legalName: "SANTET DELI CO S.L." };

describe("applyDevelopmentVenue", () => {
  it.each([real, santet])("provisions any taxpayer in preproduction: %j", async (identity) => {
    const venue = await applyDevelopmentVenue(
      planVenue(request(identity), ALL_MODULES),
      { db: suite.db, modules: ALL_MODULES },
      { WAITRON_ENV: "dev" },
    );
    expect(suite.db.all(sql`select numero_instalacion, node_id from registro_sif`)).toEqual([
      { numero_instalacion: "S000001", node_id: venue.nodeId },
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
  });

  it("refuses production before writing anything", async () => {
    const before = facts();
    await expect(
      applyDevelopmentVenue(
        planVenue(request(real), ALL_MODULES),
        { db: suite.db, modules: ALL_MODULES },
        { WAITRON_ENV: "production" },
      ),
    ).rejects.toMatchObject({
      code: "sif.throwaway_allocation_refused",
      params: { environment: "production" },
    });
    expect(facts()).toEqual(before);
  });

  it("refuses two modules offering a throwaway allocation before writing anything", async () => {
    const fiscal = ALL_MODULES.find((module) => module.name === "fiscal-verifactu")!;
    const modules = [...ALL_MODULES, { ...fiscal, name: "fiscal-twin" }];
    const before = facts();
    await expect(
      applyDevelopmentVenue(
        planVenue(request(real), ALL_MODULES),
        { db: suite.db, modules },
        { WAITRON_ENV: "dev" },
      ),
    ).rejects.toMatchObject({
      code: "module.throwaway_allocation_ambiguous",
      params: { candidates: ["fiscal-verifactu", "fiscal-twin"] },
    });
    expect(facts()).toEqual(before);
  });

  it("refuses a plan with no taxpayer with a named error, before writing anything", async () => {
    const actions = planVenue(request(real), ALL_MODULES).filter(
      (action) => action.kind !== "ensure-tenant",
    );
    const before = facts();
    await expect(
      applyDevelopmentVenue(
        actions,
        { db: suite.db, modules: ALL_MODULES },
        { WAITRON_ENV: "dev" },
      ),
    ).rejects.toMatchObject({ code: "setup.request_invalid", params: { field: "taxId" } });
    expect(facts()).toEqual(before);
  });

  it("leaves the shipped module list untouched", async () => {
    const fiscal = () => ALL_MODULES.find((module) => module.name === "fiscal-verifactu")!;
    const operations = fiscal().operations;
    await applyDevelopmentVenue(
      planVenue(request(real), ALL_MODULES),
      { db: suite.db, modules: ALL_MODULES },
      { WAITRON_ENV: "dev" },
    );
    expect(fiscal().operations).toBe(operations);
  });
});
