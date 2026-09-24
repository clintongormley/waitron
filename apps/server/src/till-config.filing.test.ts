import { beforeAll, describe, expect, it } from "vitest";
import { locations, nodes } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { nodeId as brandNodeId } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import { readFilingModule } from "./till-config.js";

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
});

let stamped: NodeId;
let bare: NodeId;

beforeAll(async () => {
  await seedTenant(suite.db);
  // `stamped` names both module columns and `bare` names neither, which is what the null case turns on.
  const [loc] = await suite.db
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const locationId = loc!.id;
  const [s] = await suite.db
    .insert(nodes)
    .values({ locationId, name: "stamped", filingModule: "verifactu", taxModule: "vat" })
    .returning({ id: nodes.id });
  const [b] = await suite.db
    .insert(nodes)
    .values({ locationId, name: "bare" })
    .returning({ id: nodes.id });
  stamped = brandNodeId(s!.id);
  bare = brandNodeId(b!.id);
});

describe("readFilingModule", () => {
  it("reads the node's stamped filing module", async () => {
    expect(await readFilingModule(suite.db, { nodeId: stamped })).toBe("verifactu");
  });
  it("is null for a node provisioning never stamped", async () => {
    expect(await readFilingModule(suite.db, { nodeId: bare })).toBeNull();
  });
});
