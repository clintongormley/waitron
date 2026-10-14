import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { invoiceSeries, locations, nodes, tenants } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { locationId as brandLocationId, nodeId as brandNodeId } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import { applyAllocatedTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import { hashPin, hashPassword } from "@waitron/identity";
import { ALL_MODULES } from "./modules.js";
import { provisionNode } from "./provision-till.js";

// Well-formed but absent — the shape a mistyped argument actually takes, since a malformed one
// never survives the `nodeId()` brand.
const ABSENT = "00000000-0000-0000-0000-000000000000";

// The full manifest, so the migrations apply in the production order.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

interface Bootstrapped {
  nodeId: NodeId;
  nif: string;
}

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(50_000_000 + nifCounter).padStart(8, "0")}K`;
}

/**
 * The pre-SIF state: tenant → location → node → node-keyed series, and NO SIF registration.
 * `@waitron/fiscal-verifactu`'s `seedTill` registers a SIF, which is why it is not reused here.
 */
async function bootstrapTenant(): Promise<Bootstrapped> {
  const nif = nextNif();
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: nif, legalName: "Deli SL" })
    .onConflictDoNothing({ target: tenants.id });

  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Mostrador",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });

  const [node] = await suite.db
    .insert(nodes)
    .values({ locationId: brandLocationId(location!.id), name: "Node 1" })
    .returning({ id: nodes.id });
  const nodeId = brandNodeId(node!.id);

  await suite.db.insert(invoiceSeries).values({ nodeId, code: "A" });

  return { nodeId, nif };
}

describe("provisioning a node that has no SIF registration yet", () => {
  it("runs every module's seed for the node — fiscal registers it under the tenant's own NIF", async () => {
    const nif = nextNif();
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

  it("refuses a node id that names no node", async () => {
    await bootstrapTenant();

    await expect(
      provisionNode(suite.db, { nodeId: brandNodeId(ABSENT) }, ALL_MODULES),
    ).rejects.toMatchObject({ code: "node.not_found", params: { id: ABSENT } });
  });
});
