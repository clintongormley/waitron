import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { NodeId } from "@waitron/shared";
import { CORE_MIGRATIONS } from "./migrations.js";
import { readMembershipTrustSet, readNodePublicKeyTx, setNodePublicKey } from "./node-identity.js";
import { withTransaction } from "./tenancy.js";
import { seedNode, seedVenue } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";

describe("membership trust-set accessors", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  let nodeId: NodeId;

  beforeEach(async () => {
    await suite.db.execute(sql`delete from nodes`);
    await seedVenue(suite.db);
    nodeId = await seedNode(suite.db);
  });

  it("readMembershipTrustSet omits a node whose public_key is null", async () => {
    expect(await readMembershipTrustSet(suite.db)).toEqual({});
  });

  it("setNodePublicKey stamps the column and readMembershipTrustSet returns { nodeId: key }", async () => {
    await setNodePublicKey(suite.db, nodeId, "PUBKEY_B64");
    expect(await readMembershipTrustSet(suite.db)).toEqual({ [nodeId]: "PUBKEY_B64" });
  });

  it("readMembershipTrustSet returns every keyed node (two-node topology)", async () => {
    // A second node in the SAME database, so both are in the trust set the read returns.
    const nodeId2 = await seedNode(suite.db);
    await setNodePublicKey(suite.db, nodeId, "KEY_A");
    await setNodePublicKey(suite.db, nodeId2, "KEY_B");
    expect(await readMembershipTrustSet(suite.db)).toEqual({
      [nodeId]: "KEY_A",
      [nodeId2]: "KEY_B",
    });
  });

  it("readNodePublicKeyTx reads the named node's key alone, and null for a keyless or unknown node", async () => {
    const nodeId2 = await seedNode(suite.db);
    const read = (id: string) => withTransaction(suite.db, (tx) => readNodePublicKeyTx(tx, id));
    await setNodePublicKey(suite.db, nodeId2, "KEY_B");
    expect(await read(nodeId)).toBeNull();
    await setNodePublicKey(suite.db, nodeId, "KEY_A");
    expect(await read(nodeId)).toBe("KEY_A");
    expect(await read(nodeId2)).toBe("KEY_B");
    expect(await read("no-such-node")).toBeNull();
  });
});
