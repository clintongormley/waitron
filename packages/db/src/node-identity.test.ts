import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import type { Database } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { readMembershipTrustSet, setNodePublicKey } from "./node-identity.js";
import { seedNode, seedTenant } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";

// PGlite, not real Postgres: this proves the query + null-filter logic (the read skips a keyless row,
// the write stamps the column). PGlite connects as superuser, so it cannot show the GRANT enforcement
// — that `app_user` holds SELECT on `nodes` and no UPDATE is pinned by the privilege matrix
// (packages/fiscal-verifactu/src/privileges.expected.ts), and the column-level ACL on `public_key` by
// the dumped-ACL diff in scripts/schema-equivalence.sh.

// There is deliberately no seedLocation helper (only seedTenant/seedNode exist — see seed.test.ts), so
// build the location the node FKs first, exactly as seedNode's own suite does.
async function seedLocation(db: Database): Promise<ReturnType<typeof brandLocationId>> {
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (name, invoice_locales, operation_description) values ('Test location', ARRAY['es']::text[], 'Restaurant') returning id`);
  return brandLocationId(loc.rows[0]!.id);
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
