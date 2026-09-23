import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { planVenue, type VenueRequest } from "./venue-plan.js";
import { applyVenue } from "./venue-apply.js";
import { readOperationalVenueIds, readTenantIdentities } from "./tenant-guard.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
});

function request(): VenueRequest {
  return {
    country: "es",
    taxId: " b12345678 ",
    legalName: "Deli SL",
    location: {
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
    },
    tillName: "Caja 1",
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

describe("readOperationalVenueIds", () => {
  it("reads nothing from an unprovisioned database", async () => {
    expect(await readOperationalVenueIds(suite.db)).toEqual([]);
  });

  it("reads the provisioned venue's id", async () => {
    const venue = await applyVenue(planVenue(request(), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    expect(await readOperationalVenueIds(suite.db)).toEqual([venue.locationId]);
  });

  it("reads every venue row, so a second venue is visible to the guard", async () => {
    await suite.db.execute(sql`
      insert into locations (id, name, invoice_locales, operation_description) values
        ('00000000-0000-4000-8000-00000000000a', 'Barra', '["es-ES"]', 'venta'),
        ('00000000-0000-4000-8000-00000000000b', 'Terraza', '["es-ES"]', 'venta')`);

    expect([...(await readOperationalVenueIds(suite.db))].sort()).toEqual([
      "00000000-0000-4000-8000-00000000000a",
      "00000000-0000-4000-8000-00000000000b",
    ]);
  });
});
