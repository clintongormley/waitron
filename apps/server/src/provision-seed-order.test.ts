import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyAllocatedTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import { hashPin, hashPassword } from "@waitron/identity";
import { ALL_MODULES } from "./modules.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

describe("first setup module seeds", () => {
  it("runs every module's seed for the node — fiscal registers it under the tenant's own NIF", async () => {
    const nif = "50000001K";
    const actions = planVenue(
      {
        country: "ES",
        taxId: nif,
        legalName: "Deli SL",
        location: {
          name: "Mostrador",
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
          displayName: "Owner",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("test-password"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    );
    const venue = await applyVenue(actions, { db: suite.db, modules: ALL_MODULES });
    const { nodeId, seeded } = venue;
    expect(seeded.map((s) => s.module)).toEqual([
      "catalogue",
      "venue-service",
      "fiscal-verifactu",
      "adjustments",
    ]);
    expect(seeded[2]!.report).toMatch(
      /^SIF .* \(installation S000001\); series A-S000001, FF-S000001, R-S000001$/,
    );

    const live = await suite.db.execute<{
      nif: string;
      id_sistema_informatico: string;
      numero_instalacion: string;
    }>(sql`select nif, id_sistema_informatico, numero_instalacion from registro_sif
           where node_id = ${nodeId} and revocado_en is null`);
    expect(live.rows).toEqual([
      { nif, id_sistema_informatico: "W1", numero_instalacion: "S000001" },
    ]);
  });
});
