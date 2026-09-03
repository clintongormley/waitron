import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { isAppError, locationId as brandLocationId } from "@waitron/shared";
import {
  captureError,
  CORE_MIGRATIONS,
  createPgliteDb,
  runMigrations,
  stampDeployment,
  setSingletonRole,
  setDeploymentMode,
  readSingletonRole,
  readMembershipTrustSet,
  readNodeMembership,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, type KeyRing } from "@waitron/credentials";
import { verifyMembershipDocument } from "@waitron/membership";
import { createDeploymentHolders } from "./deployment-holders.js";
import { establishNodeIdentity } from "./node-identity.js";
import { singletonPass } from "./singleton-pass.js";
import { DRAIN_DUTY } from "./pass.js";
import { promoteLocalSecondaryToPrimary, type PromoteDeps } from "./promote.js";

// A fixed test key ring, exactly as node-identity.test.ts uses it: the box key that seals this node's
// identity private key. Deterministic so the sealed key round-trips within the suite.
const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

// PGlite is sufficient for the promote LOGIC (fence, idempotency, mirror-guard, the holder flip, and
// now the mint): none of these has an RLS / privilege / concurrency dependency, and the reads/writes
// all succeed as the PGlite superuser (CLAUDE.md §4 — pick the lighter target when the heavier one's
// justification does not apply). `appDb` and `ownerDb` are the same handle here; the owner-vs-app
// distinction is exercised for real only against Postgres. Setup now also runs CREDENTIALS_MIGRATIONS
// and establishes a node identity so the mint has a key to sign with — the fence/mirror/already-primary
// paths return before any mint, so the established identity is harmless to them.
async function localSecondary(): Promise<{
  db: Database;
  tenantId: string;
  nodeId: string;
  deps: (log: PromoteDeps["log"]) => PromoteDeps;
}> {
  const db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, CREDENTIALS_MIGRATIONS);
  await stampDeployment(db, "preproduction");
  await setSingletonRole(db, "secondary"); // (primary, secondary) — a local secondary
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
  const nodeId = await seedNode(db, tenantId, brandLocationId(loc.rows[0]!.id));
  await establishNodeIdentity({ ownerDb: db, ring: RING }, tenantId, nodeId);
  const holders = createDeploymentHolders("primary", "secondary");
  return {
    db,
    tenantId,
    nodeId,
    deps: (log) => ({ appDb: db, ownerDb: db, holders, log, ring: RING, tenantId, nodeId }),
  };
}

const noopLog: PromoteDeps["log"] = () => {};

describe("promoteLocalSecondaryToPrimary", () => {
  it("refuses without a fence attestation and leaves state unchanged", async () => {
    const { db, deps } = await localSecondary();
    const error = await captureError(() =>
      promoteLocalSecondaryToPrimary(deps(noopLog), { oldNodeNeutralised: false }),
    );
    expect(isAppError(error) && error.code).toBe("promotion.fence_not_attested");
    expect(await readSingletonRole(db)).toBe("secondary"); // no write happened
    await db.close();
  });

  it("claims the singletons and flips the holder so the fiscal pass starts", async () => {
    const { db, deps } = await localSecondary();
    const d = deps(noopLog);

    // The SAME pass function, built once over the holder, must flip empty -> real on promotion (no restart).
    // The primary-pass stub returns a real `PassReport` — a `DutyReport[]`, not bare duty names — so the
    // wrapper is exercised at the type it actually carries (`PassReport.duties: DutyReport[]`, `pass.ts`).
    const pass = singletonPass(
      () => d.holders.singletonRole.current,
      async () => ({
        nextDueAt: null,
        duties: [{ duty: DRAIN_DUTY, ok: true, nextDueAt: null, durationMs: 0 }],
      }),
    );
    expect(await pass(new Date())).toEqual({ nextDueAt: null, duties: [] }); // secondary: empty pass

    const result = await promoteLocalSecondaryToPrimary(d, { oldNodeNeutralised: true });
    expect(result).toEqual({ alreadyPrimary: false });
    expect(await readSingletonRole(db)).toBe("primary");
    expect(d.holders.singletonRole.current).toBe("primary");
    expect((await pass(new Date())).duties.map((r) => r.duty)).toContain(DRAIN_DUTY); // primary: real pass runs
    await db.close();
  });

  it("is idempotent — a second promote on an already-primary node is a no-op", async () => {
    const { db, deps } = await localSecondary();
    const d = deps(noopLog);
    await promoteLocalSecondaryToPrimary(d, { oldNodeNeutralised: true });
    const second = await promoteLocalSecondaryToPrimary(d, { oldNodeNeutralised: true });
    expect(second).toEqual({ alreadyPrimary: true });
    expect(await readSingletonRole(db)).toBe("primary");
    await db.close();
  });

  it("mints the next membership document atomically with the role flip", async () => {
    const { db, deps, tenantId, nodeId } = await localSecondary();
    const oldNodeId = "old-node-1";
    const bystanderId = "bystander-1";
    // A held term-3 chart: an OLD serving-primary, this node as serving-secondary, and a third
    // uninvolved node — so we assert the flip touches ONLY the two it should and leaves the bystander
    // exactly as it was. promote reads only term + node list to bump, never the held signature, so a
    // placeholder signature is fine here (the node-membership.test.ts doc() fixture uses the same shape).
    await writeNodeMembership(db, {
      body: {
        term: 3,
        nodes: [
          { nodeId: oldNodeId, contactUrl: "https://old", standing: "serving-primary" },
          { nodeId, contactUrl: "", standing: "serving-secondary" },
          { nodeId: bystanderId, contactUrl: "https://bystander", standing: "sell-only" },
        ],
      },
      signerNodeId: oldNodeId,
      signature: "held-placeholder-sig",
      endorsements: [],
    });

    const result = await promoteLocalSecondaryToPrimary(deps(noopLog), {
      oldNodeNeutralised: true,
    });

    expect(result.alreadyPrimary).toBe(false);
    expect(await readSingletonRole(db)).toBe("primary");

    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(4); // bumped from 3
    const standings = Object.fromEntries(held!.body.nodes.map((n) => [n.nodeId, n.standing]));
    expect(standings[nodeId]).toBe("serving-primary");
    expect(standings[oldNodeId]).toBe("sell-only"); // outgoing primary demoted, NOT evicted
    // The old node's contactUrl is preserved (it stays a replication source until drained).
    const oldNode = held!.body.nodes.find((n) => n.nodeId === oldNodeId);
    expect(oldNode?.contactUrl).toBe("https://old");
    // The uninvolved bystander is left exactly as it was — standing AND contactUrl untouched.
    const bystander = held!.body.nodes.find((n) => n.nodeId === bystanderId);
    expect(bystander).toEqual({
      nodeId: bystanderId,
      contactUrl: "https://bystander",
      standing: "sell-only",
    });

    // The minted document is signed by THIS node's own directly-trusted key and verifies against the
    // setup-established trust set — proving a real mint, not just a term bump.
    const trust = await readMembershipTrustSet(db, tenantId);
    const verdict = verifyMembershipDocument(held!, trust);
    expect(verdict.valid).toBe(true);
    expect(held!.signerNodeId).toBe(nodeId);
    expect(held!.endorsements).toEqual([]); // R1 signs directly-trusted, no endorsement chain
    await db.close();
  });

  it("mints a term-0 document naming this node when NO membership document is held", async () => {
    // A local secondary whose primary died before any membership document ever gossiped to it:
    // `readNodeMembership` returns null, so `nextStandings` gets an empty list and must APPEND this
    // node as serving-primary (rather than leaving the org chart with no serving-primary at all).
    const { db, deps, tenantId, nodeId } = await localSecondary(); // NB: no writeNodeMembership seed

    const result = await promoteLocalSecondaryToPrimary(deps(noopLog), {
      oldNodeNeutralised: true,
    });
    expect(result.alreadyPrimary).toBe(false);

    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(0); // first document ever minted here starts at term 0
    expect(held?.body.nodes).toEqual([
      { nodeId, contactUrl: "", standing: "serving-primary" }, // appended: the sole node, serving-primary
    ]);
    // It verifies against this node's own directly-trusted key — a real signed mint, not a stub.
    const trust = await readMembershipTrustSet(db, tenantId);
    expect(verifyMembershipDocument(held!, trust).valid).toBe(true);
    await db.close();
  });

  it("is idempotent: a second promote does not bump the term again", async () => {
    const { db, deps, nodeId } = await localSecondary();
    const oldNodeId = "old-node-1";
    await writeNodeMembership(db, {
      body: {
        term: 3,
        nodes: [
          { nodeId: oldNodeId, contactUrl: "https://old", standing: "serving-primary" },
          { nodeId, contactUrl: "", standing: "serving-secondary" },
        ],
      },
      signerNodeId: oldNodeId,
      signature: "held-placeholder-sig",
      endorsements: [],
    });

    const first = await promoteLocalSecondaryToPrimary(deps(noopLog), { oldNodeNeutralised: true });
    expect(first.alreadyPrimary).toBe(false);
    expect((await readNodeMembership(db))?.body.term).toBe(4);

    const second = await promoteLocalSecondaryToPrimary(deps(noopLog), {
      oldNodeNeutralised: true,
    });
    expect(second.alreadyPrimary).toBe(true); // early return before any re-mint
    expect((await readNodeMembership(db))?.body.term).toBe(4); // term unchanged — no re-bump
    await db.close();
  });

  it("refuses a mirror with promotion.not_a_local_secondary before any write", async () => {
    const db = await createPgliteDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await stampDeployment(db, "preproduction");
    await setDeploymentMode(db, "mirror"); // (mirror, secondary)
    const holders = createDeploymentHolders("mirror", "secondary");
    const error = await captureError(() =>
      promoteLocalSecondaryToPrimary(
        // The mirror guard returns before any identity read, so placeholder ring/ids are harmless here.
        { appDb: db, ownerDb: db, holders, log: noopLog, ring: RING, tenantId: "t", nodeId: "n" },
        { oldNodeNeutralised: true },
      ),
    );
    expect(isAppError(error) && error.code).toBe("promotion.not_a_local_secondary");
    expect(await readSingletonRole(db)).toBe("secondary"); // never written
    await db.close();
  });
});
