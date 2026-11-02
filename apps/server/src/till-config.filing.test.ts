import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nodes } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { NodeId } from "@waitron/shared";
import { readFilingModule } from "./node-config.js";

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
});

let stamped: NodeId;
let bare: NodeId;

beforeAll(async () => {
  await seedVenue(suite.db, {
    name: "Barra",
    invoiceLocales: ["es-ES"],
    operationDescription: "Venta en establecimiento",
  });
  // `stamped` names both module columns and `bare` names neither, which is what the null case turns on.
  stamped = await seedNode(suite.db);
  await suite.db
    .update(nodes)
    .set({ name: "stamped", filingModule: "verifactu", taxModule: "vat" })
    .where(eq(nodes.id, stamped));
  bare = await seedNode(suite.db);
  await suite.db.update(nodes).set({ name: "bare" }).where(eq(nodes.id, bare));
});

describe("readFilingModule", () => {
  it("reads the node's stamped filing module", async () => {
    expect(await readFilingModule(suite.db, { nodeId: stamped })).toBe("verifactu");
  });
  it("is null for a node provisioning never stamped", async () => {
    expect(await readFilingModule(suite.db, { nodeId: bare })).toBeNull();
  });
});
