import { beforeAll, describe, expect, it } from "vitest";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, type KeyRing } from "@waitron/credentials";
import { CORE_MIGRATIONS, locations, readMembershipTrustSet, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { signBytes, verifyBytes } from "@waitron/membership";
import { locationId as brandLocationId } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";

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
});
