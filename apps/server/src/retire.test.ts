import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { isAppError, locationId as brandLocationId } from "@waitron/shared";
import {
  captureError,
  CORE_MIGRATIONS,
  locations,
  stampDeployment,
  readMembershipTrustSet,
  readNodeMembership,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, type KeyRing } from "@waitron/credentials";
import {
  verifyMembershipDocument,
  type MembershipNode,
  type NodeStanding,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { establishNodeIdentity } from "./node-identity.js";
import { persistEvictionOrThrow, retireSelf, type RetireDeps } from "./retire.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const noopLog: RetireDeps["log"] = () => {};

const CARRIER_ID = "carrier-1";

// Two cases depend on `useVenueDb`'s default per-test reset: each expects no chart held, and would
// otherwise read the chart an earlier case wrote.
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
  timeoutMs: 60_000,
});

let db: Database;
beforeAll(() => {
  db = suite.db;
});

// Called from each case rather than a `beforeAll`, because the per-test reset empties every table.
async function fencedNode(): Promise<{
  nodeId: string;
  deps: (log: RetireDeps["log"]) => RetireDeps;
}> {
  await stampDeployment(db, "preproduction");
  await seedTenant(db);
  // Through the table definition: `locations.id` is a `$defaultFn` generator a raw insert never
  // reaches.
  const [loc] = await db
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const nodeId = await seedNode(db, brandLocationId(loc!.id));
  await establishNodeIdentity({ ownerDb: db, ring: RING }, nodeId);
  return {
    nodeId,
    deps: (log) => ({ appDb: db, ring: RING, nodeId, log }),
  };
}

// retire reads only the term and node standings; it never verifies the held signature.
function heldDoc(
  nodeId: string,
  selfStanding: NodeStanding,
  {
    carrier = true,
    term = 3,
    carrierId = CARRIER_ID,
  }: { carrier?: boolean; term?: number; carrierId?: string } = {},
): SignedMembershipDocument {
  const nodes: MembershipNode[] = [{ nodeId, contactUrl: "", standing: selfStanding }];
  if (carrier) {
    nodes.push({ nodeId: carrierId, contactUrl: "https://carrier", standing: "serving-primary" });
  }
  return {
    body: { term, nodes },
    signerNodeId: carrier ? carrierId : nodeId,
    signature: "held-placeholder-sig",
    endorsements: [],
  };
}

describe("retireSelf", () => {
  it("self-evicts a sell-only node with a carrier, minting a bumped doc that verifies against its own key", async () => {
    const { deps, nodeId } = await fencedNode();
    await writeNodeMembership(db, heldDoc(nodeId, "sell-only"));

    const result = await retireSelf(deps(noopLog));

    expect(result).toEqual({ evicted: true, term: 4 });

    const held = await readNodeMembership(db);
    const standings = Object.fromEntries(held!.body.nodes.map((n) => [n.nodeId, n.standing]));
    expect(standings[nodeId]).toBe("evicted");
    expect(standings[CARRIER_ID]).toBe("serving-primary");
    expect(held!.signerNodeId).toBe(nodeId);
    expect(held!.endorsements).toEqual([]);

    const trust = await readMembershipTrustSet(db);
    expect(verifyMembershipDocument(held!, trust).valid).toBe(true);
  });

  it("is idempotent — an already-evicted node is a no-op, even with no carrier in the chart", async () => {
    const { deps, nodeId } = await fencedNode();
    // No carrier, so this also pins the idempotent return coming before the carrier gate.
    await writeNodeMembership(db, heldDoc(nodeId, "evicted", { carrier: false }));

    const result = await retireSelf(deps(noopLog));

    expect(result).toEqual({ evicted: false, term: 3 });
    expect((await readNodeMembership(db))?.body.term).toBe(3);
  });

  it("refuses a serving node with node.retire_not_fenced and writes nothing", async () => {
    const { deps, nodeId } = await fencedNode();
    await writeNodeMembership(db, heldDoc(nodeId, "serving-secondary"));

    const err = await captureError(() => retireSelf(deps(noopLog)));
    expect(isAppError(err) && err.code).toBe("node.retire_not_fenced");

    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(3); // no write
    const standings = Object.fromEntries(held!.body.nodes.map((n) => [n.nodeId, n.standing]));
    expect(standings[nodeId]).toBe("serving-secondary");
  });

  it("refuses a node absent from any held chart with node.retire_not_fenced", async () => {
    const { deps } = await fencedNode(); // no held document

    const err = await captureError(() => retireSelf(deps(noopLog)));
    expect(isAppError(err) && err.code).toBe("node.retire_not_fenced");
    expect(await readNodeMembership(db)).toBeNull();
  });

  it("refuses a fenced node whose chart names no serving primary with node.retire_no_carrier", async () => {
    const { deps, nodeId } = await fencedNode();
    await writeNodeMembership(db, heldDoc(nodeId, "sell-only", { carrier: false }));

    const err = await captureError(() => retireSelf(deps(noopLog)));
    expect(isAppError(err) && err.code).toBe("node.retire_no_carrier");

    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(3); // no write
    expect(held!.body.nodes.find((n) => n.nodeId === nodeId)?.standing).toBe("sell-only");
  });
});

function docAtTerm(term: number, nodeId: string): SignedMembershipDocument {
  return {
    body: { term, nodes: [{ nodeId, contactUrl: "", standing: "evicted" }] },
    signerNodeId: nodeId,
    signature: "placeholder-sig",
    endorsements: [],
  };
}

describe("persistEvictionOrThrow", () => {
  it("throws node.retire_superseded when a newer term raced in, leaving the held term intact", async () => {
    // A concurrent adopt landed a newer term between the held read and the persist.
    await writeNodeMembership(db, docAtTerm(5, "n1"));

    const err = await captureError(() => persistEvictionOrThrow(db, docAtTerm(4, "n1")));
    expect(isAppError(err) && err.code).toBe("node.retire_superseded");
    expect(isAppError(err) && err.params).toEqual({ heldTerm: 5, mintedTerm: 4 });
    expect((await readNodeMembership(db))?.body.term).toBe(5);
  });

  it("persists the eviction when the minted term is strictly newer (positive control)", async () => {
    await writeNodeMembership(db, docAtTerm(3, "n1"));

    await persistEvictionOrThrow(db, docAtTerm(4, "n1"));
    expect((await readNodeMembership(db))?.body.term).toBe(4);
  });

  it("reports a held term of -1 when the refused write leaves no chart held at all", async () => {
    // Stands in for the held row vanishing under the write: the engine skips the insert.
    await db.execute(
      sql`create trigger retire_skip_membership before insert on node_membership begin select raise(ignore); end`,
    );
    let err: unknown;
    try {
      err = await captureError(() => persistEvictionOrThrow(db, docAtTerm(4, "n1")));
    } finally {
      await db.execute(sql`drop trigger retire_skip_membership`);
    }
    expect(isAppError(err) && err.code).toBe("node.retire_superseded");
    expect(isAppError(err) && err.params).toEqual({ heldTerm: -1, mintedTerm: 4 });
    expect(await readNodeMembership(db)).toBeNull();
  });
});
