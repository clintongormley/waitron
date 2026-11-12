import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { seedVenueSettings } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { planVenue, type VenueRequest } from "./venue-plan.js";
import { applyAllocatedTestVenue as applyVenue } from "../test/allocated-venue.js";
import { hasOperationalVenue, readTenantIdentities } from "./tenant-guard.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
});

function request(): VenueRequest {
  return {
    country: "es",
    taxId: " b12345678 ",
    legalName: "Deli SL",
    name: "Mostrador",
    fiscalTerritory: "ES-common",
    invoiceLocales: ["es-ES"],
    operationDescription: "venta en establecimiento",
    addressLine1: "Calle Mayor 1",
    addressLine2: null,
    postalCode: "28013",
    city: "Madrid",
    province: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "06:00:00",
    seriesCode: "A",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Owner",
      pinHash: "scrypt$00$00",
      passwordHash: "scrypt$00$00",
      email: "owner@example.test",
    },
  };
}

describe("readTenantIdentities", () => {
  it("reads nothing from an unprovisioned database", async () => {
    expect(await readTenantIdentities(suite.db)).toEqual([]);
  });

  it("reads the stored taxpayer as the canonical pair the guard compares against", async () => {
    await applyVenue(planVenue(request(), ALL_MODULES), { db: suite.db, modules: ALL_MODULES });

    expect(await readTenantIdentities(suite.db)).toEqual([{ country: "ES", taxId: "B12345678" }]);
  });
});

describe("hasOperationalVenue", () => {
  it("recognizes the saved venue document with no location row", async () => {
    await seedVenueSettings(suite.db);
    expect(await hasOperationalVenue(suite.db)).toBe(true);
  });

  it("reads nothing from an unprovisioned database", async () => {
    expect(await hasOperationalVenue(suite.db)).toBe(false);
  });

  it("recognizes the provisioned venue document", async () => {
    await applyVenue(planVenue(request(), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    expect(await hasOperationalVenue(suite.db)).toBe(true);
  });

  it("does not count location rows as a saved venue", async () => {
    await suite.db.execute(
      sql`insert into locations (id) values ('00000000-0000-4000-8000-00000000000a')`,
    );
    expect(await hasOperationalVenue(suite.db)).toBe(false);
  });
});
