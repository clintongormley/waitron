import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, type KeyRing } from "@waitron/credentials";
import { CORE_MIGRATIONS, readMembershipTrustSet, type Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { signBytes, verifyBytes } from "@waitron/membership";
import { locationId as brandLocationId } from "@waitron/shared";
import type { NodeId, TenantId } from "@waitron/shared";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";

// PGlite, not real Postgres: `establishNodeIdentity` seals a credential owner-side and stamps
// `nodes.public_key`, both under `withTenant`. PGlite exercises this round-trip and its
// behavioural assertions on a superuser connection; it does not check grants. CLAUDE.md §4.
const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

describe("node identity establishment", () => {
  const suite = usePgliteDb({
    migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
    timeoutMs: 60_000,
  });

  let db: Database;
  let tenantId: TenantId;
  let nodeId: NodeId;

  beforeAll(async () => {
    db = suite.db;
    tenantId = await seedTenant(db);
    const loc = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
    nodeId = await seedNode(db, tenantId, brandLocationId(loc.rows[0]!.id));
  }, 60_000);

  it("establishNodeIdentity stamps a public key that becomes the sole trust anchor", async () => {
    await establishNodeIdentity({ ownerDb: db, ring: RING }, tenantId, nodeId);
    const trust = await readMembershipTrustSet(db, tenantId);
    expect(Object.keys(trust)).toEqual([nodeId]);
    expect(typeof trust[nodeId]).toBe("string"); // base64 SPKI, non-empty
    expect(trust[nodeId]!.length).toBeGreaterThan(0);
  });

  it("the sealed private key round-trips and pairs with the stamped public key", async () => {
    await establishNodeIdentity({ ownerDb: db, ring: RING }, tenantId, nodeId);
    const priv = await readNodeIdentityKey(db, RING, tenantId);
    const pub = (await readMembershipTrustSet(db, tenantId))[nodeId]!;
    // Proof they are ONE keypair: a signature by the sealed private key verifies under the stamped
    // public key. This fails if establish seals one key and stamps a DIFFERENT one.
    const sig = signBytes("membership-slice-4-probe", priv);
    expect(verifyBytes("membership-slice-4-probe", sig, pub)).toBe(true);
  });
});
