import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  captureError,
  CORE_MIGRATIONS,
  stampDeployment,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import {
  CREDENTIALS_MIGRATIONS,
  loadKeyRing,
  nodeSigningPublicKey,
  type KeyRing,
} from "@waitron/credentials";
import { sha256Hex, verifyEnvelope } from "@waitron/handover";
import {
  canonicalize,
  endorseKey,
  generateNodeKeyPair,
  signDocumentBody,
  type CanonicalValue,
  type Endorsement,
  type MembershipDocumentBody,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import { AppError } from "@waitron/shared";
import { currentBinding, peerKeyOf, signAsThisBox } from "./handover-signing.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xe).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function chart(
  signerNodeId: string,
  privateKey: string,
  nodeIds: readonly string[],
  endorsements: Endorsement[],
  revoked?: string[],
): SignedMembershipDocument {
  const body: MembershipDocumentBody = {
    term: 3,
    nodes: nodeIds.map((nodeId, i) => ({
      nodeId,
      contactUrl: `https://box-${i}`,
      standing: i === 0 ? "serving-primary" : "serving-secondary",
    })),
    ...(revoked === undefined ? {} : { revoked }),
  };
  return { body, signerNodeId, signature: signDocumentBody(body, privateKey), endorsements };
}

describe("signing and verifying handover envelopes between boxes", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS, NODE_MIGRATIONS],
  });

  async function boxes(): Promise<{ db: Database; self: string; peer: string; other: string }> {
    const db = suite.db;
    await seedVenue(db, {
      name: "Barra",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta",
    });
    const self = await seedNode(db);
    const peer = await seedNode(db);
    const other = await seedNode(db);
    for (const nodeId of [self, peer, other])
      await establishNodeIdentity({ ownerDb: db, node: suite.node, ring: RING }, nodeId);
    return { db, self, peer, other };
  }

  const publicKeyOf = (privateKey: string): string => nodeSigningPublicKey(privateKey);

  it("a box signs with its own node key and a peer verifies it with the key the chart's endorsement carries", async () => {
    const { db, self, peer } = await boxes();
    const selfKey = await readNodeIdentityKey(suite.node, RING, self);
    const peerKey = await readNodeIdentityKey(suite.node, RING, peer);
    const endorsement = endorseKey(peer, publicKeyOf(peerKey), self, selfKey);

    const envelope = await signAsThisBox({ node: suite.node, ring: RING, nodeId: peer }, "status", {
      operationId: OP,
    });
    expect(envelope.signerNodeId).toBe(peer);

    const before = await peerKeyOf({ db, node: suite.node, ring: RING, nodeId: self });
    expect(verifyEnvelope(envelope, "status", before)).toEqual({
      valid: false,
      reason: "unknown_signer",
    });

    await writeNodeMembership(db, chart(self, selfKey, [self, peer], [endorsement]));
    const after = await peerKeyOf({ db, node: suite.node, ring: RING, nodeId: self });
    expect(after(peer)).toBe(endorsement.publicKey);
    expect(after(self)).toBe(publicKeyOf(selfKey));
    expect(verifyEnvelope(envelope, "status", after)).toEqual({
      valid: true,
      body: { operationId: OP },
      signerNodeId: peer,
    });
  });

  it("a key the chart does not vouch for is unknown", async () => {
    const { db, self, peer, other } = await boxes();
    const selfKey = await readNodeIdentityKey(suite.node, RING, self);
    const stranger = generateNodeKeyPair();
    // The peer's endorsement is signed by a key this box does not trust; `other` has a key in
    // venue.db's `nodes` row but no endorsement at all.
    const forged = endorseKey(peer, stranger.publicKey, "stranger", stranger.privateKey);
    await writeNodeMembership(db, chart(self, selfKey, [self, peer, other], [forged]));
    const keyOf = await peerKeyOf({ db, node: suite.node, ring: RING, nodeId: self });
    expect(keyOf(peer)).toBeUndefined();
    expect(keyOf(other)).toBeUndefined();
    expect(keyOf("stranger")).toBeUndefined();
  });

  it("an endorsement in a held chart no stored key signed vouches for nothing", async () => {
    const { db, self, peer } = await boxes();
    const stranger = generateNodeKeyPair();
    const selfKey = await readNodeIdentityKey(suite.node, RING, self);
    const peerKey = await readNodeIdentityKey(suite.node, RING, peer);
    const endorsement = endorseKey(peer, publicKeyOf(peerKey), self, selfKey);
    await writeNodeMembership(
      db,
      chart("stranger", stranger.privateKey, [self, peer], [endorsement]),
    );
    const keyOf = await peerKeyOf({ db, node: suite.node, ring: RING, nodeId: self });
    expect(keyOf(peer)).toBeUndefined();
  });

  it("an endorsement of a box the held chart has removed vouches for nothing", async () => {
    const { db, self, peer } = await boxes();
    const selfKey = await readNodeIdentityKey(suite.node, RING, self);
    const peerKey = await readNodeIdentityKey(suite.node, RING, peer);
    const endorsement = endorseKey(peer, publicKeyOf(peerKey), self, selfKey);
    await writeNodeMembership(db, chart(self, selfKey, [self], [endorsement], [peer]));
    const keyOf = await peerKeyOf({ db, node: suite.node, ring: RING, nodeId: self });
    expect(keyOf(peer)).toBeUndefined();
  });

  it("a removed pinned primary still vouches for a box in good standing, by the package's rule", async () => {
    const { db, self, peer } = await boxes();
    const main = generateNodeKeyPair();
    await pinMainBoxKey(suite.node, self, { nodeId: "main-box", publicKey: main.publicKey });
    const selfKey = await readNodeIdentityKey(suite.node, RING, self);
    const peerPublic = publicKeyOf(await readNodeIdentityKey(suite.node, RING, peer));
    const endorsement = endorseKey(peer, peerPublic, "main-box", main.privateKey);
    await writeNodeMembership(db, chart(self, selfKey, [self, peer], [endorsement], ["main-box"]));
    const keyOf = await peerKeyOf({ db, node: suite.node, ring: RING, nodeId: self });
    expect(keyOf(peer)).toBe(peerPublic);
  });

  it("when two trusted boxes vouch different keys, the package's first trusted endorsement wins", async () => {
    const { db, self, peer } = await boxes();
    const main = generateNodeKeyPair();
    await pinMainBoxKey(suite.node, self, { nodeId: "main-box", publicKey: main.publicKey });
    const selfKey = await readNodeIdentityKey(suite.node, RING, self);
    const k1 = generateNodeKeyPair().publicKey;
    const k2 = generateNodeKeyPair().publicKey;
    await writeNodeMembership(
      db,
      chart(
        self,
        selfKey,
        [self, peer],
        [endorseKey(peer, k1, "main-box", main.privateKey), endorseKey(peer, k2, self, selfKey)],
        ["main-box"],
      ),
    );
    const keyOf = await peerKeyOf({ db, node: suite.node, ring: RING, nodeId: self });
    expect(keyOf(peer)).toBe(k1);
  });

  it("a pinned primary the held chart has removed has no key in a handover", async () => {
    const { db, self, peer } = await boxes();
    const main = generateNodeKeyPair();
    await pinMainBoxKey(suite.node, self, { nodeId: "main-box", publicKey: main.publicKey });
    const selfKey = await readNodeIdentityKey(suite.node, RING, self);
    const before = await peerKeyOf({ db, node: suite.node, ring: RING, nodeId: self });
    expect(before("main-box")).toBe(main.publicKey);
    await writeNodeMembership(db, chart(self, selfKey, [self, peer], [], ["main-box"]));
    const after = await peerKeyOf({ db, node: suite.node, ring: RING, nodeId: self });
    expect(after("main-box")).toBeUndefined();
    expect(after(self)).toBe(publicKeyOf(selfKey));
  });

  it("the binding names the taxpayer and environment, and the held chart's term and digest", async () => {
    const { db, self, peer } = await boxes();
    await stampDeployment(db, "preproduction");
    const selfKey = await readNodeIdentityKey(suite.node, RING, self);
    const held = chart(self, selfKey, [self, peer], []);
    await writeNodeMembership(db, held);
    const [tenant] = db.all<{ country: string; tax_id: string }>(
      sql`select country, tax_id from tenants where id = 1`,
    );

    const binding = await currentBinding({ db }, "controlled", self, peer, OP);
    expect(binding).toEqual({
      operationId: OP,
      scenario: "controlled",
      venue: { country: tenant!.country, taxId: tenant!.tax_id, environment: "preproduction" },
      sourceNodeId: self,
      destinationNodeId: peer,
      membership: {
        term: 3,
        digest: sha256Hex(canonicalize(held as unknown as CanonicalValue)),
      },
    });
    expect(Object.keys(binding.venue).sort()).toEqual(["country", "environment", "taxId"]);
  });

  it("a box holding no chart cannot name a binding", async () => {
    const { db, self, peer } = await boxes();
    await stampDeployment(db, "preproduction");
    await expect(currentBinding({ db }, "controlled", self, peer, OP)).rejects.toThrow(
      "no taxpayer or held chart to bind",
    );
  });

  it("a box with no environment stamp cannot name a binding", async () => {
    const { db, self, peer } = await boxes();
    const selfKey = await readNodeIdentityKey(suite.node, RING, self);
    await writeNodeMembership(db, chart(self, selfKey, [self, peer], []));
    const error = await captureError(() => currentBinding({ db }, "controlled", self, peer, OP));
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("deployment.not_stamped");
  });
});
