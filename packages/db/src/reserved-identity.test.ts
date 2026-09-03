import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import type { LocationId, TenantId } from "@waitron/shared";
import type { Endorsement } from "@waitron/membership";
import type { Database } from "./client.js";
import {
  CORE_MIGRATIONS,
  insertReservedNodeTx,
  insertReservedSeriesTx,
  readMembershipTrustSet,
  readNodeEndorsement,
  withTenant,
} from "./index.js";
import { seedNode, seedTenant } from "./testing/seed.js";
import { usePgliteDb } from "./testing/lifecycle.js";

// PGlite, not real Postgres: this proves the query/insert logic (a dormant node lands with its public
// key + endorsement, the reserved series default to next_number 1, the endorsement round-trips and null
// for a keyless node). PGlite connects as superuser and bypasses RLS, so it cannot show the GRANT
// enforcement (that the *Tx writes need the owner role, the read rides app_user's SELECT) — that is the
// concern of node-identity.rls.test.ts for the sibling public_key column, which this rides.

const ENDORSEMENT: Endorsement = {
  nodeId: "22222222-2222-2222-2222-222222222222",
  publicKey: "cloudpub",
  endorsedBy: "11111111-1111-1111-1111-111111111111",
  signature: "sig",
};
const CLOUD_NODE = ENDORSEMENT.nodeId;

// There is deliberately no seedLocation helper (only seedTenant/seedNode exist — see seed.test.ts), so
// build the location the node FKs first, exactly as node-identity.test.ts does.
async function seedLocation(
  db: Database,
  tenant: string,
): Promise<ReturnType<typeof brandLocationId>> {
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenant}, 'Test location', ARRAY['es']::text[], 'Restaurant') returning id`);
  return brandLocationId(loc.rows[0]!.id);
}

describe("reserved-identity accessors", () => {
  const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

  let tenantId: TenantId;
  let locationId: LocationId;

  beforeAll(async () => {
    tenantId = await seedTenant(suite.db);
    locationId = await seedLocation(suite.db, tenantId);
  });

  it("insertReservedNodeTx persists a dormant node with its public key + endorsement", async () => {
    await withTenant(suite.db, tenantId, (tx) =>
      insertReservedNodeTx(tx, {
        id: CLOUD_NODE,
        tenantId,
        locationId,
        name: "cloud",
        filingModule: null,
        taxModule: null,
        publicKey: "cloudpub",
        endorsement: ENDORSEMENT,
      }),
    );
    expect(await readNodeEndorsement(suite.db, tenantId, CLOUD_NODE)).toEqual(ENDORSEMENT);
    // the dormant node's public key joins the trust set (readMembershipTrustSet reads public_key)
    const trust = await readMembershipTrustSet(suite.db, tenantId);
    expect(trust[CLOUD_NODE]).toBe("cloudpub");
  });

  it("readNodeEndorsement returns null for a node with no endorsement (a primary)", async () => {
    const bare = await seedNode(suite.db, tenantId, locationId);
    expect(await readNodeEndorsement(suite.db, tenantId, bare)).toBeNull();
  });

  it("insertReservedSeriesTx inserts the reserved series at next_number 1", async () => {
    await withTenant(suite.db, tenantId, (tx) =>
      insertReservedSeriesTx(tx, [
        { tenantId, nodeId: CLOUD_NODE, code: "FA-3", purpose: "standard" },
        { tenantId, nodeId: CLOUD_NODE, code: "RF-3", purpose: "rectificative" },
      ]),
    );
    const rows = await withTenant(suite.db, tenantId, (tx) =>
      tx.execute<{ code: string; next_number: number }>(
        sql`select code, next_number from invoice_series where node_id = ${CLOUD_NODE} order by code`,
      ),
    );
    expect(rows.rows.map((r) => [r.code, Number(r.next_number)])).toEqual([
      ["FA-3", 1],
      ["RF-3", 1],
    ]);
  });
});
