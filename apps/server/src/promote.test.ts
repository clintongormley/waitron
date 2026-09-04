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
  readDeploymentMode,
  readSingletonRole,
  readMembershipTrustSet,
  readNodeMembership,
  readStandardSeriesId,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { FISCAL_MIGRATIONS } from "@waitron/fiscal-verifactu";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, type KeyRing } from "@waitron/credentials";
import {
  verifyMembershipDocument,
  type Endorsement,
  type MembershipNode,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { createDeploymentHolders } from "./deployment-holders.js";
import { establishNodeIdentity } from "./node-identity.js";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";
import { singletonPass } from "./singleton-pass.js";
import { DRAIN_DUTY } from "./pass.js";
import {
  commitMirrorPromotionTx,
  promoteLocalSecondaryToPrimary,
  promoteMirrorToPrimary,
  type MirrorPromoteDeps,
  type PromoteDeps,
} from "./promote.js";

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

// A held term-3 chart: an OLD serving-primary and this node as serving-secondary, plus any `extra`
// bystander nodes. promote reads only term + node list to bump, never the held signature, so a
// placeholder signature is fine here (the node-membership.test.ts doc() fixture uses the same shape).
function heldTermThreeDoc(
  nodeId: string,
  oldNodeId: string,
  extra: MembershipNode[] = [],
): SignedMembershipDocument {
  return {
    body: {
      term: 3,
      nodes: [
        { nodeId: oldNodeId, contactUrl: "https://old", standing: "serving-primary" },
        { nodeId, contactUrl: "", standing: "serving-secondary" },
        ...extra,
      ],
    },
    signerNodeId: oldNodeId,
    signature: "held-placeholder-sig",
    endorsements: [],
  };
}

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
    // A held term-3 chart with a third uninvolved node appended — so we assert the flip touches ONLY
    // the two it should and leaves the bystander exactly as it was.
    await writeNodeMembership(
      db,
      heldTermThreeDoc(nodeId, oldNodeId, [
        { nodeId: bystanderId, contactUrl: "https://bystander", standing: "sell-only" },
      ]),
    );

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
    await writeNodeMembership(db, heldTermThreeDoc(nodeId, oldNodeId));

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

// A held document at an arbitrary term, naming this node serving-primary. Used to seed the held chart
// for the term-guard rejection unit (which reads only term + node list, never the placeholder signature).
function docAtTerm(term: number, nodeId: string): SignedMembershipDocument {
  return {
    body: { term, nodes: [{ nodeId, contactUrl: "", standing: "serving-primary" }] },
    signerNodeId: nodeId,
    signature: "placeholder-sig",
    endorsements: [],
  };
}

// The mirror fixture: a read-only cloud node that already holds its OWN dormant identity (R2/R3a) —
// a sealed signing key under NODE_KEY_PURPOSE, an endorsement on its `nodes` row, and a reserved
// standard invoice_series — established exactly as the adopt path does via
// `establishReservedStandbyIdentity`. Stamped `mirror` (co-sets singleton_role='secondary'). PGlite is
// sufficient for the promote LOGIC (the mode/singleton flip, the endorsed term-bumped mint, and the
// term-guard): none has an RLS/privilege/concurrency dependency here — the reserved SIF's `currentSif`
// behaviour on reboot is Task 5's real-PG e2e. Runs FISCAL_MIGRATIONS too because
// `establishReservedStandbyIdentity` writes the reserved SIF (`registro_sif`).
async function mirror(): Promise<{
  db: Database;
  tenantId: string;
  nodeId: string;
  standardSeriesId: string;
  endorsement: Endorsement;
  deps: (
    log: PromoteDeps["log"],
    persistTradingEnv?: (seriesId: string) => Promise<void>,
  ) => MirrorPromoteDeps;
}> {
  const db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, CREDENTIALS_MIGRATIONS);
  await runMigrations(db, FISCAL_MIGRATIONS);
  await stampDeployment(db, "preproduction");
  await setDeploymentMode(db, "mirror"); // (mirror, secondary)
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const t = await db.execute<{ tax_id: string }>(
    sql`select tax_id from tenants where id = ${tenantId}`,
  );
  const nif = t.rows[0]!.tax_id;

  const standby = generateStandbyIdentity();
  // The primary's endorsement of the cloud's own key — stored on `nodes.endorsement`, read back by the
  // promote signer and attached to the minted document (R3b's first non-setup-signed doc).
  const endorsement: Endorsement = {
    nodeId: standby.nodeId,
    publicKey: standby.publicKey,
    endorsedBy: "primary-node",
    signature: "endorsement-sig",
  };
  await establishReservedStandbyIdentity(
    { ownerDb: db, ring: RING },
    {
      tenantId,
      locationId,
      standby,
      nodeName: "cloud",
      filingModule: "verifactu",
      taxModule: "iva",
      reserved: {
        nif,
        idSistemaInformatico: "W1",
        numeroInstalacion: 7,
        series: [{ code: "FA-7", purpose: "standard" }],
        endorsement,
      },
    },
  );
  const standardSeriesId = await readStandardSeriesId(db, tenantId, standby.nodeId);
  const holders = createDeploymentHolders("mirror", "secondary");
  return {
    db,
    tenantId,
    nodeId: standby.nodeId,
    standardSeriesId,
    endorsement,
    deps: (log, persistTradingEnv = async () => {}) => ({
      appDb: db,
      ownerDb: db,
      holders,
      log,
      ring: RING,
      tenantId,
      nodeId: standby.nodeId,
      persistTradingEnv,
    }),
  };
}

describe("promoteMirrorToPrimary", () => {
  it("flips mode+singleton to primary, mints an endorsed term-bumped doc, and returns the corrected seriesId", async () => {
    const { db, deps, nodeId, standardSeriesId, endorsement } = await mirror();
    // A held term-3 chart naming the outgoing primary as serving-primary and this node as secondary.
    await writeNodeMembership(db, heldTermThreeDoc(nodeId, "old-primary", []));

    const result = await promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true });

    expect(result.alreadyPrimary).toBe(false);
    expect(result.seriesId).toBe(standardSeriesId); // corrected to the cloud's OWN standard series
    expect(await readDeploymentMode(db)).toBe("primary");
    expect(await readSingletonRole(db)).toBe("primary");

    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(4); // bumped from 3
    const standings = Object.fromEntries(held!.body.nodes.map((n) => [n.nodeId, n.standing]));
    expect(standings[nodeId]).toBe("serving-primary");
    expect(standings["old-primary"]).toBe("sell-only"); // outgoing primary demoted, not evicted
    // Signed by the cloud's OWN key, carrying the primary's endorsement (the first non-setup-signed doc).
    expect(held!.signerNodeId).toBe(nodeId);
    expect(held!.endorsements).toEqual([endorsement]);
    await db.close();
  });

  it("persists the corrected trading.env BEFORE the point-of-no-return (a persist failure aborts the flip)", async () => {
    // The corrected series is INERT on a still-read-only mirror, so persisting trading.env BEFORE the PONR
    // is abortable with no lasting effect AND closes the crash window a persist-after-PONR would open
    // (spec §4.3 + owner decision 2026-09-04). Proven by construction: a persist that THROWS must leave
    // the node a mirror — if the flip had run first, mode would be 'primary' here.
    const { db, deps, nodeId, standardSeriesId } = await mirror();
    await writeNodeMembership(db, heldTermThreeDoc(nodeId, "old-primary"));
    const persisted: string[] = [];
    const err = await captureError(() =>
      promoteMirrorToPrimary(
        deps(noopLog, async (seriesId) => {
          persisted.push(seriesId);
          throw new Error("disk full");
        }),
        { oldNodeNeutralised: true },
      ),
    );
    expect((err as Error).message).toBe("disk full");
    expect(persisted).toEqual([standardSeriesId]); // called with the cloud's OWN corrected series
    // The PONR never ran: still a read-only mirror, singleton unclaimed, org chart not bumped.
    expect(await readDeploymentMode(db)).toBe("mirror");
    expect(await readSingletonRole(db)).toBe("secondary");
    expect((await readNodeMembership(db))?.body.term).toBe(3);
    await db.close();
  });

  it("refuses without a fence attestation, leaving the node a mirror and persisting nothing", async () => {
    const { db, deps } = await mirror();
    const persisted: string[] = [];
    const err = await captureError(() =>
      promoteMirrorToPrimary(
        deps(noopLog, async (seriesId) => {
          persisted.push(seriesId);
        }),
        { oldNodeNeutralised: false },
      ),
    );
    expect(isAppError(err) && err.code).toBe("promotion.fence_not_attested");
    expect(await readDeploymentMode(db)).toBe("mirror"); // no write
    expect(persisted).toEqual([]); // fence refusal is before any persist
    await db.close();
  });

  it("is idempotent — a second promote on an already-primary node is a no-op", async () => {
    const { db, deps, nodeId } = await mirror();
    await writeNodeMembership(db, heldTermThreeDoc(nodeId, "old-primary"));

    const first = await promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true });
    const second = await promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true });

    expect(second.alreadyPrimary).toBe(true);
    expect(first.seriesId).toBe(second.seriesId); // the same corrected series, re-derived on re-run
    expect((await readNodeMembership(db))?.body.term).toBe(4); // not re-bumped
    await db.close();
  });

  it("aborts the whole PONR with promotion.membership_superseded when a newer term raced in", async () => {
    // The R3 sharp edge (parent spec §8): a concurrent gossip-adopt lands a >= term between the mint's
    // held read and the point-of-no-return write. Proven by construction on the extracted PONR body:
    // seed held term 5, then run `commitMirrorPromotionTx` with a STALE term-4 document. The term-guard
    // (`persistNodeMembershipIfNewerTx`) refuses it, so the whole transaction — the mode/singleton flip
    // included — rolls back. This is the honest, deterministic way to exercise the guard (a real race
    // has no seam between the read and the write on one connection).
    const { db, nodeId } = await mirror();
    await writeNodeMembership(db, docAtTerm(5, nodeId));

    const err = await captureError(() =>
      db.transaction((tx) => commitMirrorPromotionTx(tx, docAtTerm(4, nodeId))),
    );
    expect(isAppError(err) && err.code).toBe("promotion.membership_superseded");
    // The whole PONR rolled back: the held term is untouched and the node is still a mirror — the flip
    // did NOT commit against the superseded chart.
    expect((await readNodeMembership(db))?.body.term).toBe(5);
    expect(await readDeploymentMode(db)).toBe("mirror");
    expect(await readSingletonRole(db)).toBe("secondary");
    await db.close();
  });
});
