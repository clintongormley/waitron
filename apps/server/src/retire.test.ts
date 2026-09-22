import { describe, expect, it } from "vitest";
import { isAppError, locationId as brandLocationId } from "@waitron/shared";
import {
  captureError,
  CORE_MIGRATIONS,
  createPgliteDb,
  locations,
  runMigrations,
  stampDeployment,
  readMembershipTrustSet,
  readNodeMembership,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
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

// A fixed test key ring, exactly as promote.test.ts uses it: the box key that seals this node's
// identity private key. Deterministic so the sealed key round-trips within the suite.
const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const noopLog: RetireDeps["log"] = () => {};

const CARRIER_ID = "carrier-1";

// PGlite is sufficient for the retire LOGIC (the standing gates, the mint, and the term-guarded
// persist): none of these has a privilege / concurrency dependency, and the reads/writes all succeed
// as the PGlite superuser (CLAUDE.md §4 — pick the lighter target when the heavier one's
// justification does not apply). The real app_user/withTransaction path (the only privilege-sensitive
// part) is never exercised here — it is the caller's concern. Setup runs CREDENTIALS_MIGRATIONS and establishes a
// node identity so the mint has a key to sign with; the gate paths that throw before the mint are
// harmless to it.
async function fencedNode(): Promise<{
  db: Database;
  nodeId: string;
  deps: (log: RetireDeps["log"]) => RetireDeps;
}> {
  const db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, CREDENTIALS_MIGRATIONS);
  await stampDeployment(db, "preproduction");
  await seedTenant(db);
  // Inserted through the table definition, the same change `packages/db/src/testing/seed.ts`
  // took: `locations.id` is a `$defaultFn(newId)` value on this engine rather than a SQL DEFAULT,
  // so a raw insert omitting it returns nothing to brand — and `array['es-ES']` is PostgreSQL
  // array syntax the engine refuses at prepare (`near "['es-ES']": syntax error`).
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
    db,
    nodeId,
    deps: (log) => ({ appDb: db, ring: RING, nodeId, log }),
  };
}

// A held chart at `term` naming this node with `selfStanding`, plus (optionally) a serving-primary
// carrier. retire reads only term + node standings; the held signature is never verified, so a
// placeholder signature is fine (the promote.test.ts fixtures use the same shape).
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
    const { db, deps, nodeId } = await fencedNode();
    await writeNodeMembership(db, heldDoc(nodeId, "sell-only"));

    const result = await retireSelf(deps(noopLog));

    expect(result).toEqual({ evicted: true, term: 4 }); // bumped from 3

    const held = await readNodeMembership(db);
    const standings = Object.fromEntries(held!.body.nodes.map((n) => [n.nodeId, n.standing]));
    expect(standings[nodeId]).toBe("evicted"); // this node left for good
    expect(standings[CARRIER_ID]).toBe("serving-primary"); // the carrier is untouched
    expect(held!.signerNodeId).toBe(nodeId); // signed by THIS departing node's own key
    expect(held!.endorsements).toEqual([]); // directly-trusted, no endorsement chain

    // The self-eviction verifies against a trust set holding the departing node's own public key —
    // proving a carrier that trusts that key (from setup/adopt) would accept the document.
    const trust = await readMembershipTrustSet(db);
    expect(verifyMembershipDocument(held!, trust).valid).toBe(true);
    await db.close();
  });

  it("is idempotent — an already-evicted node is a no-op, even with no carrier in the chart", async () => {
    const { db, deps, nodeId } = await fencedNode();
    // No carrier: the idempotent return must come BEFORE the carrier gate, or this would refuse
    // `node.retire_no_carrier` instead of reporting the held term.
    await writeNodeMembership(db, heldDoc(nodeId, "evicted", { carrier: false }));

    const result = await retireSelf(deps(noopLog));

    expect(result).toEqual({ evicted: false, term: 3 }); // held term, no bump
    expect((await readNodeMembership(db))?.body.term).toBe(3);
    await db.close();
  });

  it("refuses a serving node with node.retire_not_fenced and writes nothing", async () => {
    const { db, deps, nodeId } = await fencedNode();
    await writeNodeMembership(db, heldDoc(nodeId, "serving-secondary"));

    const err = await captureError(() => retireSelf(deps(noopLog)));
    expect(isAppError(err) && err.code).toBe("node.retire_not_fenced");

    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(3); // no write
    const standings = Object.fromEntries(held!.body.nodes.map((n) => [n.nodeId, n.standing]));
    expect(standings[nodeId]).toBe("serving-secondary"); // unchanged
    await db.close();
  });

  it("refuses a node absent from any held chart with node.retire_not_fenced", async () => {
    const { db, deps } = await fencedNode(); // NB: no writeNodeMembership seed → readNodeMembership null

    const err = await captureError(() => retireSelf(deps(noopLog)));
    expect(isAppError(err) && err.code).toBe("node.retire_not_fenced");
    expect(await readNodeMembership(db)).toBeNull(); // still no document
    await db.close();
  });

  it("refuses a fenced node whose chart names no serving primary with node.retire_no_carrier", async () => {
    const { db, deps, nodeId } = await fencedNode();
    await writeNodeMembership(db, heldDoc(nodeId, "sell-only", { carrier: false }));

    const err = await captureError(() => retireSelf(deps(noopLog)));
    expect(isAppError(err) && err.code).toBe("node.retire_no_carrier");

    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(3); // no write
    expect(held!.body.nodes.find((n) => n.nodeId === nodeId)?.standing).toBe("sell-only");
    await db.close();
  });
});

// A held document at an arbitrary term naming this node evicted. Used to drive the term-guard unit
// (which reads only term, never the placeholder signature) — promote.test.ts's docAtTerm technique.
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
    // The R3 sharp edge: a concurrent gossip-adopt landed a >= term between the held read and the
    // persist. Proven deterministically (promote's technique) — seed term 5, persist a STALE term-4
    // doc; the term-guard (`persistNodeMembershipIfNewer`) refuses it, so the eviction is not applied.
    const db = await createPgliteDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await writeNodeMembership(db, docAtTerm(5, "n1"));

    const err = await captureError(() => persistEvictionOrThrow(db, docAtTerm(4, "n1")));
    expect(isAppError(err) && err.code).toBe("node.retire_superseded");
    expect(isAppError(err) && err.params).toEqual({ heldTerm: 5, mintedTerm: 4 });
    expect((await readNodeMembership(db))?.body.term).toBe(5); // not regressed
    await db.close();
  });

  it("persists the eviction when the minted term is strictly newer (positive control)", async () => {
    const db = await createPgliteDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await writeNodeMembership(db, docAtTerm(3, "n1"));

    await persistEvictionOrThrow(db, docAtTerm(4, "n1"));
    expect((await readNodeMembership(db))?.body.term).toBe(4); // the row moved to the newer term
    await db.close();
  });
});
