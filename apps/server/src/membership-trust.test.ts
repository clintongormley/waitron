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
  signDocumentBody,
  type Endorsement,
  type MembershipDocumentBody,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { assertHeldDocumentTrusted, readStoredTrustSet } from "./membership-trust.js";

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
    migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS, { ...NODE_MIGRATIONS, database: "node" }],
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
