import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  loadKeyRing,
  readNodeSigningKey,
  sealNodeSigningKeyTx,
  type KeyRing,
} from "@waitron/credentials";
import {
  CORE_MIGRATIONS,
  captureError,
  locations,
  readMembershipTrustSet,
  setNodePublicKey,
  withNodeTransaction,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { generateNodeKeyPair, signBytes, verifyBytes } from "@waitron/membership";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import { isAppError, type NodeId } from "@waitron/shared";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";

// A row that opens without a usable `privateKey` cannot be sealed through the store, so the read
// is replaced instead, for the cases that set this.
let readOverride: (() => Promise<string | null>) | null = null;
vi.mock("@waitron/credentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/credentials")>();
  return {
    ...actual,
    readNodeSigningKey: (...args: Parameters<typeof actual.readNodeSigningKey>) =>
      readOverride === null ? actual.readNodeSigningKey(...args) : readOverride(),
  };
});
afterEach(() => {
  readOverride = null;
});

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

describe("node identity establishment", () => {
  const suite = useVenueDb({
    resetPerTest: false,
    migrations: [CORE_MIGRATIONS, { ...NODE_MIGRATIONS, database: "node" }],
    timeoutMs: 60_000,
  });

  let db: Database;
  let node: NodeDatabase;
  let nodeId: NodeId;
  let otherNodeId: NodeId;
  let locationId: ReturnType<typeof brandLocationId>;

  beforeAll(async () => {
    db = suite.db;
    node = suite.node;
    await seedTenant(db);
    const [loc] = await db
      .insert(locations)
      .values({
        name: "Barra",
        invoiceLocales: ["es-ES"],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    locationId = brandLocationId(loc!.id);
    nodeId = await seedNode(db, locationId);
    otherNodeId = await seedNode(db, locationId);
  }, 60_000);

  it("establishNodeIdentity stamps a public key that becomes the sole trust anchor", async () => {
    await establishNodeIdentity({ ownerDb: db, node, ring: RING }, nodeId);
    const trust = await readMembershipTrustSet(db);
    expect(Object.keys(trust)).toEqual([nodeId]);
    expect(typeof trust[nodeId]).toBe("string");
    expect(trust[nodeId]!.length).toBeGreaterThan(0);
  });

  it("the sealed private key round-trips and pairs with the stamped public key", async () => {
    await establishNodeIdentity({ ownerDb: db, node, ring: RING }, nodeId);
    const priv = await readNodeIdentityKey(node, RING, nodeId);
    const pub = (await readMembershipTrustSet(db))[nodeId]!;
    // A signature by the sealed private key verifies under the stamped public key only if the two
    // are one keypair.
    const sig = signBytes("membership-slice-4-probe", priv);
    expect(verifyBytes("membership-slice-4-probe", sig, pub)).toBe(true);
  });

  it("a second establish reuses the sealed key and stamps the same public key", async () => {
    await establishNodeIdentity({ ownerDb: db, node, ring: RING }, nodeId);
    const sealed = await readNodeSigningKey(node, RING, nodeId);
    const stamped = (await readMembershipTrustSet(db))[nodeId];

    await establishNodeIdentity({ ownerDb: db, node, ring: RING }, nodeId);

    expect(await readNodeSigningKey(node, RING, nodeId)).toBe(sealed);
    expect((await readMembershipTrustSet(db))[nodeId]).toBe(stamped);
  });

  it("a key sealed before its public half was stamped is stamped by the next establish", async () => {
    const { privateKey, publicKey } = generateNodeKeyPair();
    await withNodeTransaction(node, (tx) =>
      sealNodeSigningKeyTx(tx, RING, otherNodeId, privateKey),
    );

    await establishNodeIdentity({ ownerDb: db, node, ring: RING }, otherNodeId);

    expect((await readMembershipTrustSet(db))[otherNodeId]).toBe(publicKey);
    expect(await readNodeSigningKey(node, RING, otherNodeId)).toBe(privateKey);
  });

  it("reads the key only for the node id it is asked about", async () => {
    await establishNodeIdentity({ ownerDb: db, node, ring: RING }, nodeId);
    const error = await captureError(() =>
      readNodeIdentityKey(node, RING, "dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
    );
    expect(isAppError(error) && error.code).toBe("credentials.missing");
    expect(isAppError(error) && error.params).toEqual({ purpose: "membership.node_key" });
  });

  it("refuses a node key sealed without privateKey, naming the field", async () => {
    readOverride = () =>
      Promise.reject(
        new AppError("credentials.malformed_payload", { purpose: "membership.node_key" }),
      );

    const error = await captureError(() => readNodeIdentityKey(node, RING, nodeId));
    expect(isAppError(error) && error.code).toBe("server.credential_unusable");
    expect(isAppError(error) && error.params).toEqual({
      purpose: "membership.node_key",
      field: "privateKey",
    });
  });

  it("stamps nothing in venue.db when node.db refuses to seal the key", async () => {
    const unsealedNodeId = await seedNode(db, locationId);
    await node.execute(
      sql.raw(`create trigger refuse_signing_key before insert on node_signing_key
        begin select raise(abort, 'refused by test'); end`),
    );
    try {
      await expect(
        establishNodeIdentity({ ownerDb: db, node, ring: RING }, unsealedNodeId),
      ).rejects.toThrow("refused by test");
      expect((await readMembershipTrustSet(db))[unsealedNodeId]).toBeUndefined();
    } finally {
      await node.execute(sql`drop trigger if exists refuse_signing_key`);
    }
  });

  it("refuses node.identity_mismatch when the venue names a different public key", async () => {
    await establishNodeIdentity({ ownerDb: db, node, ring: RING }, nodeId);
    const sealed = await readNodeSigningKey(node, RING, nodeId);
    const foreign = generateNodeKeyPair().publicKey;
    await setNodePublicKey(db, nodeId, foreign);

    const error = await captureError(() =>
      establishNodeIdentity({ ownerDb: db, node, ring: RING }, nodeId),
    );

    expect(isAppError(error) && error.code).toBe("node.identity_mismatch");
    expect((await readMembershipTrustSet(db))[nodeId]).toBe(foreign);
    expect(await readNodeSigningKey(node, RING, nodeId)).toBe(sealed);
  });
});
