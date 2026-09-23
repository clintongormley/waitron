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

// PGlite, not real Postgres: this proves the query + null-filter logic (the read skips a keyless row,
// the write stamps the column).

// There is deliberately no seedLocation helper (only seedTenant/seedNode exist — see seed.test.ts), so
// build the location the node FKs first, exactly as seedNode's own suite does.
// Drizzle rather than raw SQL, for two things the raw insert relied on PostgreSQL for. Run against
// this engine the old statement is refused at prepare with `near "['es']": syntax error` (node
// v26.7.0, `node:sqlite`) — there is no array literal and no `::text[]` cast. And `locations.id` is
// `id("id").primaryKey().$defaultFn(newId)`, a JavaScript generator rather than a SQL DEFAULT, so a
// raw insert that omits the column reaches nothing to fill it. Both are handled by going through
// drizzle, which encodes `invoiceLocales` as the JSON text the column now holds and calls the
// generator; `seedNode` in `./testing/seed.ts` is built the same way.
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
  const pg = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  let nodeId: NodeId;

  beforeEach(async () => {
    await pg.db.execute(sql`delete from nodes`);
    await seedTenant(pg.db);
    nodeId = await seedNode(pg.db, await seedLocation(pg.db));
  });

  it("readMembershipTrustSet omits a node whose public_key is null", async () => {
    expect(await readMembershipTrustSet(pg.db)).toEqual({});
  });

  it("setNodePublicKey stamps the column and readMembershipTrustSet returns { nodeId: key }", async () => {
    await setNodePublicKey(pg.db, nodeId, "PUBKEY_B64");
    expect(await readMembershipTrustSet(pg.db)).toEqual({ [nodeId]: "PUBKEY_B64" });
  });

  it("readMembershipTrustSet returns every keyed node (two-node topology)", async () => {
    // A second node in the SAME database, so both are in the trust set the read returns.
    const nodeId2 = await seedNode(pg.db, await seedLocation(pg.db));
    await setNodePublicKey(pg.db, nodeId, "KEY_A");
    await setNodePublicKey(pg.db, nodeId2, "KEY_B");
    expect(await readMembershipTrustSet(pg.db)).toEqual({
      [nodeId]: "KEY_A",
      [nodeId2]: "KEY_B",
    });
  });
});
