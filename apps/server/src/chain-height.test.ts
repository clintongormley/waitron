import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { readChainHeight } from "./chain-height.js";
import { ALL_MODULES } from "./modules.js";

// The full manifest, because `applyVenue` provisions every module's tables.
const LOCALE = "es-ES";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

// One fixed NIF: this suite owns its own venue directory, so nothing else ever writes the `tenants`
// row the uniqueness constraint covers.
const NIF = "72000001K";

/** Provision one venue as the owner; the fixture mirrors `management-api.status.test.ts`'s `setupTenant()`. */
async function setupVenue(): Promise<{ nodeId: string }> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: NIF,
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
        tillName: "Caja 1",
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
  return { nodeId: venue.nodeId };
}

describe("readChainHeight", () => {
  let nodeId: string;

  beforeAll(async () => {
    ({ nodeId } = await setupVenue());
  });

  it("returns 0 / null for a node with no cadenas row", async () => {
    // Provisioning seeds this venue's own chain head at `secuencia = 0`, so the "absent row" branch is
    // reached only by a node_id with no chain row, such as a random uuid.
    const result = await withTransaction(suite.db, async (tx) => {
      return readChainHeight(tx, randomUUID());
    });
    expect(result).toEqual({ height: 0, lastAt: null });
  });

  it("returns the cadenas secuencia + actualizado_en once a chain row exists", async () => {
    // A fixture write, never a path the product takes. What is under test is the READ below.
    await suite.db.execute(sql`
      insert into cadenas (node_id, secuencia, actualizado_en)
      values (${nodeId}, 7, '2026-08-29T10:00:00Z')
      on conflict (node_id) do update set secuencia = 7, actualizado_en = '2026-08-29T10:00:00Z'`);

    const result = await withTransaction(suite.db, async (tx) => {
      return readChainHeight(tx, nodeId);
    });
    expect(result.height).toBe(7);
    expect(result.lastAt).toBe("2026-08-29T10:00:00.000Z");
  });
});
