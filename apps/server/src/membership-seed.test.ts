import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, type KeyRing } from "@waitron/credentials";
import {
  CORE_MIGRATIONS,
  readMembershipTrustSet,
  readNodeMembership,
  type Database,
} from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { verifyMembershipDocument } from "@waitron/membership";
import { locationId as brandLocationId, type NodeId, type TenantId } from "@waitron/shared";
import { establishNodeIdentity } from "./node-identity.js";
import { seedTermZeroMembership } from "./membership-seed.js";

// PGlite, not real Postgres: this suite exercises the crypto/read/write ROUND-TRIP of the term-0
// document. PGlite's only role is superuser, which bypasses RLS, so it proves the mint + persist +
// verify path, not the RLS enforcement (which node-identity's real-Postgres siblings cover). §4.
const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

describe("seedTermZeroMembership", () => {
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
    await establishNodeIdentity({ ownerDb: db, ring: RING }, tenantId, nodeId);
  }, 60_000);

  it("seeds a signed term-0 document naming this node serving-primary", async () => {
    await seedTermZeroMembership({ db, ring: RING }, tenantId, nodeId, "https://box.deli.test");
    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(0);
    expect(held?.body.nodes).toEqual([
      { nodeId, contactUrl: "https://box.deli.test", standing: "serving-primary" },
    ]);
    const trust = await readMembershipTrustSet(db, tenantId);
    expect(verifyMembershipDocument(held!, trust).valid).toBe(true);
  });
});
