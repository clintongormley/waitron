import { beforeAll, describe, expect, it } from "vitest";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, type KeyRing } from "@waitron/credentials";
import { eq } from "drizzle-orm";
import {
  captureError,
  CORE_MIGRATIONS,
  locations,
  nodes,
  readMembershipTrustSet,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  endorseKey,
  generateNodeKeyPair,
  signDocumentBody,
  verifyMembershipDocument,
  type MembershipDocumentBody,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { isAppError, locationId as brandLocationId } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { mintNextMembershipDocument } from "./membership-mint.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

describe("mintNextMembershipDocument", () => {
  const suite = useVenueDb({
    resetPerTest: false,
    migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS, NODE_MIGRATIONS],
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
    await establishNodeIdentity({ ownerDb: db, node: suite.node, ring: RING }, nodeId);
  }, 60_000);

  it("carries the signer's stored endorsement without the caller passing it", async () => {
    const endorser = generateNodeKeyPair();
    const ownKey = (await readMembershipTrustSet(db))[nodeId]!;
    const endorsement = endorseKey(nodeId, ownKey, "endorser-node", endorser.privateKey);
    await db.update(nodes).set({ endorsement }).where(eq(nodes.id, nodeId));
    try {
      const doc = await mintNextMembershipDocument(
        { db, node: suite.node, ring: RING },
        {
          heldDocument: null,
          nodes: [{ nodeId, contactUrl: "", standing: "serving-primary" }],
          signerNodeId: nodeId,
          verifyHeld: "none",
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
      { db, node: suite.node, ring: RING },
      {
        heldDocument: null,
        nodes: [{ nodeId, contactUrl: "", standing: "serving-primary" }],
        signerNodeId: nodeId,
        verifyHeld: "none",
      },
    );
    expect(doc.endorsements).toEqual([]);
  });

  describe("the held chart's check", () => {
    function strangerChart(): SignedMembershipDocument {
      const stranger = generateNodeKeyPair();
      const body: MembershipDocumentBody = {
        term: 3,
        nodes: [{ nodeId, contactUrl: "", standing: "serving-primary" }],
      };
      return {
        body,
        signerNodeId: "stranger-box",
        signature: signDocumentBody(body, stranger.privateKey),
        endorsements: [],
      };
    }

    it("refuses membership.held_untrusted under stored-keys when no stored key vouches for the chart", async () => {
      const error = await captureError(() =>
        mintNextMembershipDocument(
          { db, node: suite.node, ring: RING },
          {
            heldDocument: strangerChart(),
            nodes: [{ nodeId, contactUrl: "", standing: "serving-primary" }],
            signerNodeId: nodeId,
            verifyHeld: "stored-keys",
          },
        ),
      );
      expect(isAppError(error) && error.code).toBe("membership.held_untrusted");
      expect(isAppError(error) && error.params).toEqual({ reason: "untrusted_signer" });
    });

    it("signs over the same chart under none", async () => {
      const doc = await mintNextMembershipDocument(
        { db, node: suite.node, ring: RING },
        {
          heldDocument: strangerChart(),
          nodes: [{ nodeId, contactUrl: "", standing: "serving-primary" }],
          signerNodeId: nodeId,
          verifyHeld: "none",
        },
      );
      expect(doc.body.term).toBe(4);
    });

    it("passes a chart this box signed under stored-keys", async () => {
      const own = await readNodeIdentityKey(suite.node, RING, nodeId);
      const body: MembershipDocumentBody = {
        term: 5,
        nodes: [{ nodeId, contactUrl: "", standing: "serving-primary" }],
      };
      const held: SignedMembershipDocument = {
        body,
        signerNodeId: nodeId,
        signature: signDocumentBody(body, own),
        endorsements: [],
      };
      const doc = await mintNextMembershipDocument(
        { db, node: suite.node, ring: RING },
        { heldDocument: held, nodes: body.nodes, signerNodeId: nodeId, verifyHeld: "stored-keys" },
      );
      expect(doc.body.term).toBe(6);
    });
  });

  it("signs and checks with a private key the caller supplies, unsealing nothing", async () => {
    const supplied = generateNodeKeyPair();
    const unsealedNode = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const body: MembershipDocumentBody = {
      term: 1,
      nodes: [{ nodeId: unsealedNode, contactUrl: "", standing: "serving-primary" }],
    };
    const held: SignedMembershipDocument = {
      body,
      signerNodeId: unsealedNode,
      signature: signDocumentBody(body, supplied.privateKey),
      endorsements: [],
    };
    const doc = await mintNextMembershipDocument(
      { db, node: suite.node, ring: RING, signerPrivateKey: supplied.privateKey },
      {
        heldDocument: held,
        nodes: body.nodes,
        signerNodeId: unsealedNode,
        verifyHeld: "stored-keys",
      },
    );
    const verdict = verifyMembershipDocument(doc, { [unsealedNode]: supplied.publicKey });
    expect(verdict.valid ? "valid" : verdict.reason).toBe("valid");
  });
});
