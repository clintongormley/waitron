import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { isAppError, locationId as brandLocationId } from "@waitron/shared";
import {
  captureError,
  CORE_MIGRATIONS,
  createPgliteDb,
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
import type { DrainProgress } from "@waitron/sync";
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

// PGlite is sufficient for the retire LOGIC (the standing gates, the disposal-boolean gate, the
// mint, and the term-guarded persist): none of these has a privilege / concurrency dependency,
// and the reads/writes all succeed as the PGlite superuser (CLAUDE.md §4 — pick the lighter
// target when the heavier one's justification does not apply). `readDrainProgress` is injected,
// so the real app_user/withTenant path (the only privilege-sensitive part) is never exercised
// here — it is the caller's (Task 3) concern. Setup runs CREDENTIALS_MIGRATIONS and establishes a
// node identity so the mint has a key to sign with; the gate paths that throw before the mint are
// harmless to it.
async function fencedNode(): Promise<{
  db: Database;
  tenantId: string;
  nodeId: string;
  deps: (
    log: RetireDeps["log"],
    readDrainProgress: RetireDeps["readDrainProgress"],
    carrierNodeId?: RetireDeps["carrierNodeId"],
  ) => RetireDeps;
}> {
  const db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, CREDENTIALS_MIGRATIONS);
  await stampDeployment(db, "preproduction");
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
  const nodeId = await seedNode(db, tenantId, brandLocationId(loc.rows[0]!.id));
  await establishNodeIdentity({ ownerDb: db, ring: RING }, tenantId, nodeId);
  return {
    db,
    tenantId,
    nodeId,
    // `carrierNodeId` defaults to CARRIER_ID — the serving-primary the default `heldDoc` names — so the
    // request-time carrier-freshness guard passes for every test whose held chart carries CARRIER_ID.
    // Tests exercising a carrier CHANGE pass an explicit id that differs from the held serving-primary.
    deps: (log, readDrainProgress, carrierNodeId = CARRIER_ID) => ({
      appDb: db,
      ring: RING,
      tenantId,
      nodeId,
      readDrainProgress,
      carrierNodeId,
      log,
    }),
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

const drained: DrainProgress = { drained: true, ownTailSeq: 5n, carrierAppliedSeq: 5n };

describe("retireSelf", () => {
  it("self-evicts a drained sell-only node, minting a bumped doc that verifies against its own key", async () => {
    const { db, deps, tenantId, nodeId } = await fencedNode();
    await writeNodeMembership(db, heldDoc(nodeId, "sell-only"));

    const result = await retireSelf(deps(noopLog, async () => drained));

    expect(result).toEqual({ evicted: true, term: 4 }); // bumped from 3

    const held = await readNodeMembership(db);
    const standings = Object.fromEntries(held!.body.nodes.map((n) => [n.nodeId, n.standing]));
    expect(standings[nodeId]).toBe("evicted"); // this node left for good
    expect(standings[CARRIER_ID]).toBe("serving-primary"); // the carrier is untouched
    expect(held!.signerNodeId).toBe(nodeId); // signed by THIS departing node's own key
    expect(held!.endorsements).toEqual([]); // directly-trusted, no endorsement chain

    // The self-eviction verifies against a trust set holding the departing node's own public key —
    // proving a carrier that trusts that key (from setup/adopt) would accept the document.
    const trust = await readMembershipTrustSet(db, tenantId);
    expect(verifyMembershipDocument(held!, trust).valid).toBe(true);
    await db.close();
  });

  it("is idempotent — an already-evicted node is a no-op and never consults the drain guard", async () => {
    const { db, deps, nodeId } = await fencedNode();
    await writeNodeMembership(db, heldDoc(nodeId, "evicted"));

    const spy: RetireDeps["readDrainProgress"] = async () => {
      throw new Error("drain guard must not be consulted for an already-evicted node");
    };
    const result = await retireSelf(deps(noopLog, spy));

    expect(result).toEqual({ evicted: false, term: 3 }); // held term, no bump
    expect((await readNodeMembership(db))?.body.term).toBe(3);
    await db.close();
  });

  it("refuses a serving node with node.retire_not_fenced and writes nothing", async () => {
    const { db, deps, nodeId } = await fencedNode();
    await writeNodeMembership(db, heldDoc(nodeId, "serving-secondary"));

    const err = await captureError(() => retireSelf(deps(noopLog, async () => drained)));
    expect(isAppError(err) && err.code).toBe("node.retire_not_fenced");

    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(3); // no write
    const standings = Object.fromEntries(held!.body.nodes.map((n) => [n.nodeId, n.standing]));
    expect(standings[nodeId]).toBe("serving-secondary"); // unchanged
    await db.close();
  });

  it("refuses a node absent from any held chart with node.retire_not_fenced", async () => {
    const { db, deps } = await fencedNode(); // NB: no writeNodeMembership seed → readNodeMembership null

    const err = await captureError(() => retireSelf(deps(noopLog, async () => drained)));
    expect(isAppError(err) && err.code).toBe("node.retire_not_fenced");
    expect(await readNodeMembership(db)).toBeNull(); // still no document
    await db.close();
  });

  it("refuses a fenced node with no carrier with node.retire_no_carrier and writes nothing", async () => {
    const { db, deps, nodeId } = await fencedNode();
    await writeNodeMembership(db, heldDoc(nodeId, "sell-only", { carrier: false }));

    // undefined readDrainProgress is how the caller signals "held document names no carrier".
    const err = await captureError(() => retireSelf(deps(noopLog, undefined)));
    expect(isAppError(err) && err.code).toBe("node.retire_no_carrier");

    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(3); // no write
    expect(held!.body.nodes.find((n) => n.nodeId === nodeId)?.standing).toBe("sell-only");
    await db.close();
  });

  it("refuses with node.retire_no_carrier when a drain reader is passed but the boot carrier id is undefined", async () => {
    // Boundary hardening (Copilot): the invariant "readDrainProgress defined ⇒ carrierNodeId defined" is
    // boot-derived, but retireSelf must not lean on a non-null assertion — a reader passed WITHOUT a
    // carrier id is refused fail-safe as no_carrier, never a carrier_changed carrying an undefined
    // boundCarrierNodeId. `deps`'s default would substitute CARRIER_ID, so override carrierNodeId directly.
    const { db, deps, nodeId } = await fencedNode();
    await writeNodeMembership(db, heldDoc(nodeId, "sell-only")); // held names a carrier
    const base = deps(noopLog, async () => drained);
    const err = await captureError(() => retireSelf({ ...base, carrierNodeId: undefined }));
    expect(isAppError(err) && err.code).toBe("node.retire_no_carrier");

    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(3); // no write
    expect(held!.body.nodes.find((n) => n.nodeId === nodeId)?.standing).toBe("sell-only");
    await db.close();
  });

  it("refuses an undrained fenced node with node.retire_not_drained and writes nothing", async () => {
    const { db, deps, nodeId } = await fencedNode();
    await writeNodeMembership(db, heldDoc(nodeId, "sell-only"));

    const undrained: DrainProgress = { drained: false, ownTailSeq: 5n, carrierAppliedSeq: 2n };
    const err = await captureError(() => retireSelf(deps(noopLog, async () => undrained)));
    expect(isAppError(err) && err.code).toBe("node.retire_not_drained");

    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(3); // no write
    expect(held!.body.nodes.find((n) => n.nodeId === nodeId)?.standing).toBe("sell-only");
    await db.close();
  });

  it("refuses when the held chart now names a DIFFERENT carrier than the boot-bound one (node.retire_carrier_changed) and writes nothing", async () => {
    // The I1 data-loss guard: a fenced node bakes its carrier at boot and does NOT restart on a carrier
    // change, so the injected `readDrainProgress` keys on the STALE boot carrier ("C1"). Here the fresh
    // held chart names serving-primary "C2" — a second failover — while `deps.carrierNodeId` is still
    // "C1". `readDrainProgress` returns drained:true against C1, but C2 (the current survivor) may not
    // hold this node's tail. retireSelf must REFUSE and let the operator restart the box, never evict
    // against a stale carrier (fiscal-unrecoverable). Proven by deletion: remove the guard and this node
    // wrongly evicts (mints term 4) against the stale carrier.
    const { db, deps, nodeId } = await fencedNode();
    await writeNodeMembership(db, heldDoc(nodeId, "sell-only", { carrierId: "C2" }));

    const err = await captureError(() => retireSelf(deps(noopLog, async () => drained, "C1")));
    expect(isAppError(err) && err.code).toBe("node.retire_carrier_changed");
    expect(isAppError(err) && err.params).toEqual({
      boundCarrierNodeId: "C1",
      currentCarrierNodeId: "C2",
    });

    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(3); // no eviction written
    expect(held!.body.nodes.find((n) => n.nodeId === nodeId)?.standing).toBe("sell-only");
    await db.close();
  });

  it("refuses when the fresh chart names NO carrier though one was bound at boot (node.retire_carrier_changed, currentCarrierNodeId null)", async () => {
    // Boot captured a carrier "C1" (so `readDrainProgress` is bound), but the fresh held chart now names
    // no serving-primary at all — the carrier changed OUT of existence. `servingPrimaryNodeId` returns
    // undefined ⇒ reported as `currentCarrierNodeId: null`, distinct from the bound "C1".
    const { db, deps, nodeId } = await fencedNode();
    await writeNodeMembership(db, heldDoc(nodeId, "sell-only", { carrier: false }));

    const err = await captureError(() => retireSelf(deps(noopLog, async () => drained, "C1")));
    expect(isAppError(err) && err.code).toBe("node.retire_carrier_changed");
    expect(isAppError(err) && err.params).toEqual({
      boundCarrierNodeId: "C1",
      currentCarrierNodeId: null,
    });

    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(3); // no eviction written
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
