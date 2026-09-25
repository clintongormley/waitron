import { beforeAll, describe, expect, it } from "vitest";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, type KeyRing } from "@waitron/credentials";
import {
  CORE_MIGRATIONS,
  locations,
  readMembershipTrustSet,
  readNodeMembership,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { verifyMembershipDocument } from "@waitron/membership";
import { locationId as brandLocationId, type NodeId } from "@waitron/shared";
import { establishNodeIdentity } from "./node-identity.js";
import { seedTermZeroMembership } from "./membership-seed.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

describe("seedTermZeroMembership", () => {
  const suite = useVenueDb({
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

  it("seeds a signed term-0 document naming this node serving-primary", async () => {
    await seedTermZeroMembership({ db, ring: RING }, nodeId, "https://box.deli.test");
    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(0);
    expect(held?.body.nodes).toEqual([
      { nodeId, contactUrl: "https://box.deli.test", standing: "serving-primary" },
    ]);
    const trust = await readMembershipTrustSet(db);
    expect(verifyMembershipDocument(held!, trust).valid).toBe(true);
  });
});
