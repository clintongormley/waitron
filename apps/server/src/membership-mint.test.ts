import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, type KeyRing } from "@waitron/credentials";
import { CORE_MIGRATIONS, type Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import type { Endorsement } from "@waitron/membership";
import { locationId as brandLocationId } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import { establishNodeIdentity } from "./node-identity.js";
import { mintNextMembershipDocument } from "./membership-mint.js";

// PGlite is sufficient: this is pure build/sign logic exercised through the same
// `establishNodeIdentity` glue as node-identity.test.ts, not a privilege concern. CLAUDE.md §4.
const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

describe("mintNextMembershipDocument", () => {
  const suite = usePgliteDb({
    resetPerTest: false,
    migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
    timeoutMs: 60_000,
  });

  let db: Database;
  let nodeId: NodeId;

  beforeAll(async () => {
    db = suite.db;
    await seedTenant(db);
    const loc = await db.execute<{ id: string }>(sql`
      insert into locations (name, invoice_locales, operation_description)
      values ('Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
    nodeId = await seedNode(db, brandLocationId(loc.rows[0]!.id));
    await establishNodeIdentity({ ownerDb: db, ring: RING }, nodeId);
  }, 60_000);

  it("forwards endorsements onto the signed document", async () => {
    const endorsement: Endorsement = {
      nodeId,
      publicKey: "b64pub",
      endorsedBy: "primary-node",
      signature: "b64sig",
    };
    const doc = await mintNextMembershipDocument(
      { db, ring: RING },
      {
        heldDocument: null,
        nodes: [{ nodeId, contactUrl: "", standing: "serving-primary" }],
        signerNodeId: nodeId,
        endorsements: [endorsement],
      },
    );
    expect(doc.endorsements).toEqual([endorsement]);
  });

  it("defaults to no endorsements when none are given (R1 behaviour preserved)", async () => {
    const doc = await mintNextMembershipDocument(
      { db, ring: RING },
      {
        heldDocument: null,
        nodes: [{ nodeId, contactUrl: "", standing: "serving-primary" }],
        signerNodeId: nodeId,
      },
    );
    expect(doc.endorsements).toEqual([]);
  });
});
