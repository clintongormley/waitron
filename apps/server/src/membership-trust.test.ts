import { describe, expect, it } from "vitest";
import { isAppError, locationId as brandLocationId } from "@waitron/shared";
import {
  captureError,
  CORE_MIGRATIONS,
  locations,
  readMembershipTrustSet,
  setNodePublicKey,
  type Database,
} from "@waitron/db";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, type KeyRing } from "@waitron/credentials";
import {
  endorseKey,
  generateNodeKeyPair,
  MAX_NODES,
  MAX_REVOKED,
  signDocumentBody,
  verifyDocumentSigner,
  type Endorsement,
  type MembershipDocumentBody,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import {
  assertHeldDocumentReadable,
  assertHeldDocumentTrusted,
  readStoredTrustSet,
} from "./membership-trust.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xd).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const MAIN = generateNodeKeyPair();
const MAIN_ID = "main-box";

function signed(
  signerNodeId: string,
  privateKey: string,
  endorsements: Endorsement[] = [],
): SignedMembershipDocument {
  const body: MembershipDocumentBody = {
    term: 2,
    nodes: [{ nodeId: MAIN_ID, contactUrl: "https://main", standing: "serving-primary" }],
  };
  return { body, signerNodeId, signature: signDocumentBody(body, privateKey), endorsements };
}

describe("the held document's check against the keys this box stores", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS, NODE_MIGRATIONS],
  });

  async function box(): Promise<{ db: Database; nodeId: string }> {
    const db = suite.db;
    await seedTenant(db);
    const [loc] = await db
      .insert(locations)
      .values({ name: "Barra", invoiceLocales: ["es-ES"], operationDescription: "Venta" })
      .returning({ id: locations.id });
    const nodeId = await seedNode(db, brandLocationId(loc!.id));
    await establishNodeIdentity({ ownerDb: db, node: suite.node, ring: RING }, nodeId);
    return { db, nodeId };
  }

  const deps = (nodeId: string) => ({ node: suite.node, ring: RING, nodeId });

  it("trusts a document signed by the pinned main box", async () => {
    const { nodeId } = await box();
    await pinMainBoxKey(suite.node, nodeId, { nodeId: MAIN_ID, publicKey: MAIN.publicKey });
    await expect(
      assertHeldDocumentTrusted(deps(nodeId), signed(MAIN_ID, MAIN.privateKey)),
    ).resolves.toBeUndefined();
  });

  it("trusts a document signed by this box", async () => {
    const { nodeId } = await box();
    const own = await readNodeIdentityKey(suite.node, RING, nodeId);
    expect(await readStoredTrustSet(deps(nodeId))).toEqual({
      [nodeId]: (await readMembershipTrustSet(suite.db))[nodeId],
    });
    await expect(
      assertHeldDocumentTrusted(deps(nodeId), signed(nodeId, own)),
    ).resolves.toBeUndefined();
  });

  it("takes this box's key from the private key the caller supplies, unsealing nothing", async () => {
    const supplied = generateNodeKeyPair();
    const unsealedNode = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    expect(
      await readStoredTrustSet({ ...deps(unsealedNode), privateKey: supplied.privateKey }),
    ).toEqual({ [unsealedNode]: supplied.publicKey });
  });

  it("trusts a document signed by a spare the main box endorsed", async () => {
    const { nodeId } = await box();
    await pinMainBoxKey(suite.node, nodeId, { nodeId: MAIN_ID, publicKey: MAIN.publicKey });
    const spare = generateNodeKeyPair();
    const endorsement = endorseKey("spare-box", spare.publicKey, MAIN_ID, MAIN.privateKey);
    await expect(
      assertHeldDocumentTrusted(deps(nodeId), signed("spare-box", spare.privateKey, [endorsement])),
    ).resolves.toBeUndefined();
  });

  it("passes when no document is held", async () => {
    const { nodeId } = await box();
    await expect(assertHeldDocumentTrusted(deps(nodeId), null)).resolves.toBeUndefined();
  });

  it("refuses a document signed by a key only venue.db names, with reason untrusted_signer", async () => {
    const { db, nodeId } = await box();
    const [loc] = await db
      .insert(locations)
      .values({ name: "Terraza", invoiceLocales: ["es-ES"], operationDescription: "Venta" })
      .returning({ id: locations.id });
    const otherId = await seedNode(db, brandLocationId(loc!.id));
    const other = generateNodeKeyPair();
    await setNodePublicKey(db, otherId, other.publicKey);
    expect((await readMembershipTrustSet(db))[otherId]).toBe(other.publicKey);

    const error = await captureError(() =>
      assertHeldDocumentTrusted(deps(nodeId), signed(otherId, other.privateKey)),
    );
    expect(isAppError(error) && error.code).toBe("membership.held_untrusted");
    expect(isAppError(error) && error.params).toEqual({ reason: "untrusted_signer" });
  });

  it("refuses a document whose signature does not match the pinned key, with reason bad_signature", async () => {
    const { nodeId } = await box();
    await pinMainBoxKey(suite.node, nodeId, { nodeId: MAIN_ID, publicKey: MAIN.publicKey });
    const error = await captureError(() =>
      assertHeldDocumentTrusted(deps(nodeId), signed(MAIN_ID, generateNodeKeyPair().privateKey)),
    );
    expect(isAppError(error) && error.params).toEqual({ reason: "bad_signature" });
  });

  it.each(["this box", "the pinned main box"])(
    "refuses a document signed with a key venue.db names for %s, with reason bad_signature",
    async (whose) => {
      const { db, nodeId } = await box();
      const [loc] = await db
        .insert(locations)
        .values({ name: "Terraza", invoiceLocales: ["es-ES"], operationDescription: "Venta" })
        .returning({ id: locations.id });
      const mainId = await seedNode(db, brandLocationId(loc!.id));
      await pinMainBoxKey(suite.node, nodeId, { nodeId: mainId, publicKey: MAIN.publicKey });
      const signerId = whose === "this box" ? nodeId : mainId;
      const attacker = generateNodeKeyPair();
      await setNodePublicKey(db, signerId, attacker.publicKey);
      const doc = signed(signerId, attacker.privateKey);
      // venue.db's own keys would trust it, so only a trust set read from node.db refuses it.
      expect(verifyDocumentSigner(doc, await readMembershipTrustSet(db))).toEqual({
        trusted: true,
        signerNodeId: signerId,
      });

      const error = await captureError(() => assertHeldDocumentTrusted(deps(nodeId), doc));
      expect(isAppError(error) && error.code).toBe("membership.held_untrusted");
      expect(isAppError(error) && error.params).toEqual({ reason: "bad_signature" });
    },
  );

  it("refuses a spare's document whose endorsement the pinned key did not sign, with reason endorsement_invalid", async () => {
    const { nodeId } = await box();
    await pinMainBoxKey(suite.node, nodeId, { nodeId: MAIN_ID, publicKey: MAIN.publicKey });
    const spare = generateNodeKeyPair();
    const forged = endorseKey("spare-box", spare.publicKey, MAIN_ID, spare.privateKey);
    const error = await captureError(() =>
      assertHeldDocumentTrusted(deps(nodeId), signed("spare-box", spare.privateKey, [forged])),
    );
    expect(isAppError(error) && error.params).toEqual({ reason: "endorsement_invalid" });
  });

  it("leaves a malformed document the pinned main box signed to the checks after it", async () => {
    const { nodeId } = await box();
    await pinMainBoxKey(suite.node, nodeId, { nodeId: MAIN_ID, publicKey: MAIN.publicKey });
    const malformed = { ...signed(MAIN_ID, MAIN.privateKey), note: "x" };
    await expect(
      assertHeldDocumentTrusted(deps(nodeId), malformed as SignedMembershipDocument),
    ).resolves.toBeUndefined();
  });

  it("refuses a malformed document a stranger signed, with reason untrusted_signer", async () => {
    const { nodeId } = await box();
    await pinMainBoxKey(suite.node, nodeId, { nodeId: MAIN_ID, publicKey: MAIN.publicKey });
    const malformed = { ...signed("stranger", generateNodeKeyPair().privateKey), note: "x" };
    const error = await captureError(() =>
      assertHeldDocumentTrusted(deps(nodeId), malformed as SignedMembershipDocument),
    );
    expect(isAppError(error) && error.code).toBe("membership.held_untrusted");
    expect(isAppError(error) && error.params).toEqual({ reason: "untrusted_signer" });
  });

  it("refuses a document too broken to verify, with reason malformed", async () => {
    const { nodeId } = await box();
    await pinMainBoxKey(suite.node, nodeId, { nodeId: MAIN_ID, publicKey: MAIN.publicKey });
    const unsigned = { ...signed(MAIN_ID, MAIN.privateKey), signature: undefined };
    const error = await captureError(() =>
      assertHeldDocumentTrusted(deps(nodeId), unsigned as unknown as SignedMembershipDocument),
    );
    expect(isAppError(error) && error.code).toBe("membership.held_untrusted");
    expect(isAppError(error) && error.params).toEqual({ reason: "malformed" });
  });
});

describe("the held document's readability check", () => {
  const node = (nodeId: string) => ({ nodeId, contactUrl: "", standing: "serving-secondary" });
  const withBody = (body: unknown) =>
    ({ ...signed(MAIN_ID, MAIN.privateKey), body }) as unknown as SignedMembershipDocument;

  it.each<[string, unknown]>([
    ["a document that is not an object", 5],
    ["a body that is a list", withBody([])],
    ["a body with no nodes list", withBody({ term: 3 })],
    ["a term that is text", withBody({ term: "3", nodes: [] })],
    ["a term that is a fraction", withBody({ term: 1.5, nodes: [] })],
    ["a negative term", withBody({ term: -1, nodes: [] })],
    ["a node that is not an object", withBody({ term: 3, nodes: [null] })],
    ["a node with no text id", withBody({ term: 3, nodes: [{ ...node("a"), nodeId: 1 }] })],
    [
      "a node with no text address",
      withBody({ term: 3, nodes: [{ ...node("a"), contactUrl: 1 }] }),
    ],
    ["a node with no text standing", withBody({ term: 3, nodes: [{ ...node("a"), standing: 1 }] })],
    [
      "more than MAX_NODES nodes",
      withBody({ term: 3, nodes: Array.from({ length: MAX_NODES + 1 }, (_, i) => node(`n${i}`)) }),
    ],
    ["a cleared list that is text", withBody({ term: 3, nodes: [], revoked: "gone" })],
    ["a cleared id that is not text", withBody({ term: 3, nodes: [], revoked: [1] })],
    [
      "more than MAX_REVOKED cleared ids",
      withBody({ term: 3, nodes: [], revoked: Array.from({ length: MAX_REVOKED + 1 }, String) }),
    ],
  ])("refuses %s with reason malformed", (_, held) => {
    const error = captureSync(() => assertHeldDocumentReadable(held as SignedMembershipDocument));
    expect(isAppError(error) && error.code).toBe("membership.held_untrusted");
    expect(isAppError(error) && error.params).toEqual({ reason: "malformed" });
  });

  it.each<[string, unknown]>([
    ["no document", null],
    [
      "MAX_NODES nodes and MAX_REVOKED cleared ids",
      withBody({
        term: 0,
        nodes: Array.from({ length: MAX_NODES }, (_, i) => node(`n${i}`)),
        revoked: Array.from({ length: MAX_REVOKED }, String),
      }),
    ],
    ["a cleared id named twice", withBody({ term: 3, nodes: [node("a")], revoked: ["g", "g"] })],
    [
      "a node with a field beyond its three",
      withBody({ term: 3, nodes: [{ ...node("a"), x: 1 }] }),
    ],
    ["a body with a field beyond its own", withBody({ term: 3, nodes: [], note: "x" })],
  ])("passes %s to the checks after it", (_, held) => {
    expect(() => assertHeldDocumentReadable(held as SignedMembershipDocument)).not.toThrow();
  });
});

function captureSync(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}
