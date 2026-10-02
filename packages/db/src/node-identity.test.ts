import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import type { Database } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { readMembershipTrustSet, setNodePublicKey } from "./node-identity.js";
import { locations } from "./schema/tenants.js";
import { seedNode, seedTenant } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";

// Drizzle rather than raw SQL: drizzle encodes `invoiceLocales` as the JSON text the column holds,
// and `locations.id` is a JavaScript `$defaultFn` generator that a raw insert never reaches.
async function seedLocation(db: Database): Promise<ReturnType<typeof brandLocationId>> {
  const [row] = await db
    .insert(locations)
    .values({
      name: "Test location",
      invoiceLocales: ["es"],
      operationDescription: "Restaurant",
    })
    .returning({ id: locations.id });
  return brandLocationId(row!.id);
}

describe("membership trust-set accessors", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  let nodeId: NodeId;

  beforeEach(async () => {
    await suite.db.execute(sql`delete from nodes`);
    await seedTenant(suite.db);
    nodeId = await seedNode(suite.db, await seedLocation(suite.db));
  });

  it("readMembershipTrustSet omits a node whose public_key is null", async () => {
    expect(await readMembershipTrustSet(suite.db)).toEqual({});
  });

  it("setNodePublicKey stamps the column and readMembershipTrustSet returns { nodeId: key }", async () => {
    await setNodePublicKey(suite.db, nodeId, "PUBKEY_B64");
    expect(await readMembershipTrustSet(suite.db)).toEqual({ [nodeId]: "PUBKEY_B64" });
  });

  it("readMembershipTrustSet returns every keyed node (two-node topology)", async () => {
    // A second node in the SAME database, so both are in the trust set the read returns.
    const nodeId2 = await seedNode(suite.db, await seedLocation(suite.db));
    await setNodePublicKey(suite.db, nodeId, "KEY_A");
    await setNodePublicKey(suite.db, nodeId2, "KEY_B");
    expect(await readMembershipTrustSet(suite.db)).toEqual({
      [nodeId]: "KEY_A",
      [nodeId2]: "KEY_B",
    });
  });
});
