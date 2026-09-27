import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, type KeyRing } from "@waitron/credentials";
import {
  CORE_MIGRATIONS,
  captureError,
  locations,
  readMembershipTrustSet,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { signBytes, verifyBytes } from "@waitron/membership";
import { locationId as brandLocationId } from "@waitron/shared";
import { isAppError, type NodeId } from "@waitron/shared";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";

// `putCredential` refuses a payload missing a field, so a row sealed under an older field list
// cannot be written through the vault; the read is replaced instead, for the cases that set this.
let decryptedOverride: Record<string, string> | null = null;
vi.mock("@waitron/credentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/credentials")>();
  return {
    ...actual,
    getCredential: (...args: Parameters<typeof actual.getCredential>) =>
      decryptedOverride === null
        ? actual.getCredential(...args)
        : Promise.resolve(decryptedOverride),
  };
});
afterEach(() => {
  decryptedOverride = null;
});

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

describe("node identity establishment", () => {
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
  }, 60_000);

  it("establishNodeIdentity stamps a public key that becomes the sole trust anchor", async () => {
    await establishNodeIdentity({ ownerDb: db, ring: RING }, nodeId);
    const trust = await readMembershipTrustSet(db);
    expect(Object.keys(trust)).toEqual([nodeId]);
    expect(typeof trust[nodeId]).toBe("string");
    expect(trust[nodeId]!.length).toBeGreaterThan(0);
  });

  it("the sealed private key round-trips and pairs with the stamped public key", async () => {
    await establishNodeIdentity({ ownerDb: db, ring: RING }, nodeId);
    const priv = await readNodeIdentityKey(db, RING);
    const pub = (await readMembershipTrustSet(db))[nodeId]!;
    // A signature by the sealed private key verifies under the stamped public key only if the two
    // are one keypair.
    const sig = signBytes("membership-slice-4-probe", priv);
    expect(verifyBytes("membership-slice-4-probe", sig, pub)).toBe(true);
  });

  it("refuses a node key sealed without privateKey, naming the field", async () => {
    decryptedOverride = {};

    const error = await captureError(() => readNodeIdentityKey(db, RING));
    expect(isAppError(error) && error.code).toBe("server.credential_unusable");
    expect(isAppError(error) && error.params).toEqual({
      purpose: "membership.node_key",
      field: "privateKey",
    });
  });
});
