import { beforeAll, describe, expect, it } from "vitest";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, type KeyRing } from "@waitron/credentials";
import { eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  locations,
  nodes,
  readMembershipTrustSet,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { endorseKey, generateNodeKeyPair, verifyMembershipDocument } from "@waitron/membership";
import { locationId as brandLocationId } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import { establishNodeIdentity } from "./node-identity.js";
import { mintNextMembershipDocument } from "./membership-mint.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

describe("mintNextMembershipDocument", () => {
  const suite = useVenueDb({
    resetPerTest: false,
    migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
    timeoutMs: 60_000,
  });

  let db: Database;
  let nodeId: NodeId;

  beforeAll(async () => {
    db = suite.db;
    await seedTenant(db);
    const [loc] = await db
      .insert(locations)
      .values({
        name: "Barra",
        invoiceLocales: ["es-ES"],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    nodeId = await seedNode(db, brandLocationId(loc!.id));
    await establishNodeIdentity({ ownerDb: db, ring: RING }, nodeId);
  }, 60_000);

  it("carries the signer's stored endorsement without the caller passing it", async () => {
    const endorser = generateNodeKeyPair();
    const ownKey = (await readMembershipTrustSet(db))[nodeId]!;
    const endorsement = endorseKey(nodeId, ownKey, "endorser-node", endorser.privateKey);
    await db.update(nodes).set({ endorsement }).where(eq(nodes.id, nodeId));
    try {
      const doc = await mintNextMembershipDocument(
        { db, ring: RING },
        {
          heldDocument: null,
          nodes: [{ nodeId, contactUrl: "", standing: "serving-primary" }],
          signerNodeId: nodeId,
        },
      );
      expect(doc.endorsements).toEqual([endorsement]);
      const byEndorser = verifyMembershipDocument(doc, { "endorser-node": endorser.publicKey });
      expect(byEndorser.valid ? "valid" : byEndorser.reason).toBe("valid");
      const direct = verifyMembershipDocument(doc, { [nodeId]: ownKey });
      expect(direct.valid ? "valid" : direct.reason).toBe("valid");
    } finally {
      await db.update(nodes).set({ endorsement: null }).where(eq(nodes.id, nodeId));
    }
  });

  it("carries no endorsement when the signer's row holds none", async () => {
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
