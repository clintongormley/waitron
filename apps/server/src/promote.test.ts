import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { isAppError, locationId as brandLocationId } from "@waitron/shared";
import {
  captureError,
  CORE_MIGRATIONS,
  locations,
  stampDeployment,
  setSingletonRole,
  setDeploymentMode,
  readDeploymentMode,
  readSingletonRole,
  readMembershipTrustSet,
  readNodeMembership,
  readStandardSeriesId,
  withTransaction,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
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
import { ALL_MODULES } from "./modules.js";
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

// A held term-3 chart marking THIS node fenced (`sell-only`/`evicted`), with a serving-primary
// carrier alongside it. This is exactly what membership rejoin R1 reconciles a fenced node to —
// `(mode='primary', singleton_role='secondary')`, the SAME axis pair as a healthy local secondary —
// so the axis guards pass and only the fence gate can refuse it. promote reads only term + node list,
// so a placeholder signature is fine here (as in `heldTermThreeDoc`).
function heldFencedDoc(
  nodeId: string,
  standing: "sell-only" | "evicted",
  carrierNodeId = "carrier-node",
): SignedMembershipDocument {
  return {
    body: {
      term: 3,
      nodes: [
        { nodeId: carrierNodeId, contactUrl: "https://carrier", standing: "serving-primary" },
        { nodeId, contactUrl: "", standing },
      ],
    },
    signerNodeId: carrierNodeId,
    signature: "held-placeholder-sig",
    endorsements: [],
  };
}

describe("promoteLocalSecondaryToPrimary", () => {
  // One migrated venue file for this whole block. `useVenueDb` empties the DATA after every case
  // (schema survives), so `localSecondary()` below re-seeds from an empty schema on each `it` —
  // which is the per-case isolation the `createPgliteDb()` call it replaces used to give by opening
  // a new database. The suite is declared inside the describe, not at module scope, so its hooks do
  // not also fire around the mirror block's cases (the same split
  // `packages/db/src/node-membership.test.ts` makes for the same reason).
  //
  // There is no target choice left to justify: one storage engine, one file, one write connection, and no
  // roles. What the block still proves is the promote LOGIC — fence, idempotency, mirror-guard,
  // the holder flip and the mint.
  //
  // Setup also applies CREDENTIALS_MIGRATIONS and establishes a node identity so the mint has a key
  // to sign with — the fence/mirror/already-primary paths return before any mint, so the
  // established identity is harmless to them.
  //
  // The reset is doing real work here, measured rather than assumed: adding `resetPerTest: false`
  // to this call and re-running `vitest run src/promote.test.ts` fails the term-0 mint case with
  // `expected 5 to be +0`, because it then reads the previous case's held document (2026-09-22).
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
    timeoutMs: 60_000,
  });

  async function localSecondary(): Promise<{
    db: Database;
    nodeId: string;
    deps: (log: PromoteDeps["log"]) => PromoteDeps;
  }> {
    const db = suite.db;
    await stampDeployment(db, "preproduction");
    await seedTenant(db);
    // Inserted through the table definition, the same change `packages/db/src/testing/seed.ts` took:
    // `locations.id` is a `$defaultFn(newId)` value on this engine rather than a SQL DEFAULT, so a raw
    // insert omitting it returns nothing to brand — and `array['es-ES']` is PostgreSQL array syntax
    // the engine refuses at prepare.
    const [loc] = await db
      .insert(locations)
      .values({
        name: "Barra",
        invoiceLocales: ["es-ES"],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    const nodeId = await seedNode(db, brandLocationId(loc!.id));
    await setSingletonRole(db, nodeId, "secondary"); // (primary, secondary) — a local secondary
    await establishNodeIdentity({ ownerDb: db, ring: RING }, nodeId);
    const holders = createDeploymentHolders("primary", "secondary");
    return {
      db,
      nodeId,
      deps: (log) => ({ db, holders, log, ring: RING, nodeId }),
    };
  }

  it("refuses without a fence attestation and leaves state unchanged", async () => {
    const { db, deps, nodeId } = await localSecondary();
    const error = await captureError(() =>
      promoteLocalSecondaryToPrimary(deps(noopLog), { oldNodeNeutralised: false }),
    );
    expect(isAppError(error) && error.code).toBe("promotion.fence_not_attested");
    expect(await readSingletonRole(db, nodeId)).toBe("secondary"); // no write happened
  });

  it("claims the singletons and flips the holder so the fiscal pass starts", async () => {
    const { db, deps, nodeId } = await localSecondary();
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
    expect(await readSingletonRole(db, nodeId)).toBe("primary");
    expect(d.holders.singletonRole.current).toBe("primary");
    expect((await pass(new Date())).duties.map((r) => r.duty)).toContain(DRAIN_DUTY); // primary: real pass runs
  });

  it("is idempotent — a second promote on an already-primary node is a no-op", async () => {
    const { db, deps, nodeId } = await localSecondary();
    const d = deps(noopLog);
    await promoteLocalSecondaryToPrimary(d, { oldNodeNeutralised: true });
    const second = await promoteLocalSecondaryToPrimary(d, { oldNodeNeutralised: true });
    expect(second).toEqual({ alreadyPrimary: true });
    expect(await readSingletonRole(db, nodeId)).toBe("primary");
  });

  it("mints the next membership document atomically with the role flip", async () => {
    const { db, deps, nodeId } = await localSecondary();
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
    expect(await readSingletonRole(db, nodeId)).toBe("primary");

    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(4); // bumped from 3
    const standings = Object.fromEntries(held!.body.nodes.map((n) => [n.nodeId, n.standing]));
    expect(standings[nodeId]).toBe("serving-primary");
    expect(standings[oldNodeId]).toBe("sell-only"); // outgoing primary demoted, NOT evicted
    // The old node's contactUrl is preserved because `sell-only` is a ROUTABLE standing — a till may
    // still dial the demoted node (`routableServers` in packages/membership/src/fence.ts filters on
    // `contactUrl !== ""`, so clearing it here would drop the node off every till's route list).
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
    const trust = await readMembershipTrustSet(db);
    const verdict = verifyMembershipDocument(held!, trust);
    expect(verdict.valid).toBe(true);
    expect(held!.signerNodeId).toBe(nodeId);
    expect(held!.endorsements).toEqual([]); // R1 signs directly-trusted, no endorsement chain
  });

  it("mints a term-0 document naming this node when NO membership document is held", async () => {
    // A local secondary whose primary died before any membership document ever gossiped to it:
    // `readNodeMembership` returns null, so `nextStandings` gets an empty list and must APPEND this
    // node as serving-primary (rather than leaving the org chart with no serving-primary at all).
    const { db, deps, nodeId } = await localSecondary(); // NB: no writeNodeMembership seed

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
    const trust = await readMembershipTrustSet(db);
    expect(verifyMembershipDocument(held!, trust).valid).toBe(true);
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
  });

  it("refuses a fenced (sell-only) node with promotion.node_fenced and writes nothing", async () => {
    // A fenced node reconciled to (primary, secondary) by rejoin R1 passes both axis guards, so only
    // the fence gate stands between it and resuming submitter duties on a superseded chain (two
    // submitters under one NIF, CLAUDE.md §5). It must be refused in place.
    const { db, deps, nodeId } = await localSecondary();
    await writeNodeMembership(db, heldFencedDoc(nodeId, "sell-only"));
    const error = await captureError(() =>
      promoteLocalSecondaryToPrimary(deps(noopLog), { oldNodeNeutralised: true }),
    );
    expect(isAppError(error) && error.code).toBe("promotion.node_fenced");
    expect(isAppError(error) && error.params).toEqual({ standing: "sell-only" });
    expect(await readSingletonRole(db, nodeId)).toBe("secondary"); // never promoted
    expect((await readNodeMembership(db))?.body.term).toBe(3); // no re-mint
  });

  it("refuses a fenced (evicted) node with promotion.node_fenced and writes nothing", async () => {
    const { db, deps, nodeId } = await localSecondary();
    await writeNodeMembership(db, heldFencedDoc(nodeId, "evicted"));
    const error = await captureError(() =>
      promoteLocalSecondaryToPrimary(deps(noopLog), { oldNodeNeutralised: true }),
    );
    expect(isAppError(error) && error.code).toBe("promotion.node_fenced");
    expect(isAppError(error) && error.params).toEqual({ standing: "evicted" });
    expect(await readSingletonRole(db, nodeId)).toBe("secondary"); // never promoted
    expect((await readNodeMembership(db))?.body.term).toBe(3); // no re-mint
  });

  it("refuses a mirror with promotion.not_a_local_secondary before any write", async () => {
    // Not `localSecondary()`: this case stamps a MIRROR and establishes no identity. The suite's
    // file also carries the credentials tables, which is harmless here — the mirror guard returns
    // before any identity read.
    const db = suite.db;
    const nodeId = "n";
    await stampDeployment(db, "preproduction");
    await setDeploymentMode(db, nodeId, "mirror"); // (mirror, secondary)
    const holders = createDeploymentHolders("mirror", "secondary");
    const error = await captureError(() =>
      promoteLocalSecondaryToPrimary(
        // The mirror guard returns before any identity read, so placeholder ring/ids are harmless here.
        { db, holders, log: noopLog, ring: RING, nodeId },
        { oldNodeNeutralised: true },
      ),
    );
    expect(isAppError(error) && error.code).toBe("promotion.not_a_local_secondary");
    expect(await readSingletonRole(db, nodeId)).toBe("secondary"); // never written
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

describe("promoteMirrorToPrimary", () => {
  // The FULL manifest, applied once to one venue file. `establishReservedStandbyIdentity` writes the
  // reserved SIF (`registro_sif`), and each module lands on top of its dependencies in one ordered
  // set — the production order, which is why this is `migrationOptionsFor(manifestSets(), null)`
  // rather than a hand-picked three. `useVenueDb` empties the data after every case, so the `mirror()`
  // fixture below re-seeds from an empty schema per `it`, exactly as the per-case `createPgliteDb()`
  // it replaces did. It is declared inside this describe so its hooks do not also fire around the
  // local-secondary block's cases.
  //
  // What this block proves is the promote LOGIC (the mode/singleton flip, the endorsed term-bumped
  // mint, and the term-guard); none of that has a concurrency dependency. The reserved SIF's
  // `currentSif` behaviour on reboot is a separate e2e.
  //
  // The reset is doing real work here, measured rather than assumed: adding `resetPerTest: false`
  // to this call and re-running `vitest run src/promote.test.ts` fails five of this block's six
  // cases, each of which needs a node the previous case has not already promoted (2026-09-22).
  const suite = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });

  // The mirror fixture: a read-only cloud node that already holds its OWN dormant identity (R2/R3a)
  // — a sealed signing key under NODE_KEY_PURPOSE, an endorsement on its `nodes` row, and a
  // reserved standard invoice_series — established exactly as the adopt path does via
  // `establishReservedStandbyIdentity`. Stamped `mirror` (co-sets singleton_role='secondary').
  async function mirror(): Promise<{
    db: Database;
    nodeId: string;
    standardSeriesId: string;
    endorsement: Endorsement;
    deps: (
      log: PromoteDeps["log"],
      persistTradingEnv?: (seriesId: string) => Promise<void>,
    ) => MirrorPromoteDeps;
  }> {
    const db = suite.db;
    await stampDeployment(db, "preproduction");
    await seedTenant(db);
    // Through the table definition rather than raw SQL, for the reason the local-secondary fixture
    // above states: `locations.id` defaults in the client here, not in the engine.
    const [loc] = await db
      .insert(locations)
      .values({
        name: "Barra",
        invoiceLocales: ["es-ES"],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    const locationId = loc!.id;
    const t = await db.execute<{ tax_id: string }>(sql`select tax_id from tenants where id = 1`);
    const nif = t.rows[0]!.tax_id;

    const standby = generateStandbyIdentity();
    await setDeploymentMode(db, standby.nodeId, "mirror"); // (mirror, secondary)
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
        locationId,
        standby,
        nodeName: "cloud",
        filingModule: "verifactu",
        taxModule: "vat",
        modules: ALL_MODULES,
        reserved: {
          modules: {
            "fiscal-verifactu": { nif, idSistemaInformatico: "W1", numeroInstalacion: 7 },
          },
          series: [{ code: "FA-7", purpose: "standard" }],
          endorsement,
        },
      },
    );
    const standardSeriesId = await readStandardSeriesId(db, standby.nodeId);
    const holders = createDeploymentHolders("mirror", "secondary");
    return {
      db,
      nodeId: standby.nodeId,
      standardSeriesId,
      endorsement,
      deps: (log, persistTradingEnv = async () => {}) => ({
        db,
        holders,
        log,
        ring: RING,
        nodeId: standby.nodeId,
        persistTradingEnv,
      }),
    };
  }

  it("flips mode+singleton to primary, mints an endorsed term-bumped doc, and returns the corrected seriesId", async () => {
    const { db, deps, nodeId, standardSeriesId, endorsement } = await mirror();
    // A held term-3 chart naming the outgoing primary as serving-primary and this node as secondary.
    await writeNodeMembership(db, heldTermThreeDoc(nodeId, "old-primary", []));

    const result = await promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true });

    expect(result.alreadyPrimary).toBe(false);
    expect(result.seriesId).toBe(standardSeriesId); // corrected to the cloud's OWN standard series
    expect(await readDeploymentMode(db, nodeId)).toBe("primary");
    expect(await readSingletonRole(db, nodeId)).toBe("primary");

    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(4); // bumped from 3
    const standings = Object.fromEntries(held!.body.nodes.map((n) => [n.nodeId, n.standing]));
    expect(standings[nodeId]).toBe("serving-primary");
    expect(standings["old-primary"]).toBe("sell-only"); // outgoing primary demoted, not evicted
    // Signed by the cloud's OWN key, carrying the primary's endorsement (the first non-setup-signed doc).
    expect(held!.signerNodeId).toBe(nodeId);
    expect(held!.endorsements).toEqual([endorsement]);
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
    expect(await readDeploymentMode(db, nodeId)).toBe("mirror");
    expect(await readSingletonRole(db, nodeId)).toBe("secondary");
    expect((await readNodeMembership(db))?.body.term).toBe(3);
  });

  it("refuses without a fence attestation, leaving the node a mirror and persisting nothing", async () => {
    const { db, deps, nodeId } = await mirror();
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
    expect(await readDeploymentMode(db, nodeId)).toBe("mirror"); // no write
    expect(persisted).toEqual([]); // fence refusal is before any persist
  });

  it("is idempotent — a second promote on an already-primary node is a no-op", async () => {
    const { db, deps, nodeId } = await mirror();
    await writeNodeMembership(db, heldTermThreeDoc(nodeId, "old-primary"));

    const first = await promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true });
    const second = await promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true });

    expect(second.alreadyPrimary).toBe(true);
    expect(first.seriesId).toBe(second.seriesId); // the same corrected series, re-derived on re-run
    expect((await readNodeMembership(db))?.body.term).toBe(4); // not re-bumped
  });

  it("refuses a fenced node with promotion.node_fenced, leaving it a mirror and persisting nothing", async () => {
    // A fenced mirror (its held doc marks it sell-only/evicted) must not be promoted in place either —
    // it returns to service via wipe-and-restore, never by resuming duties on a superseded chain. The
    // refusal is after the held read but before the mint AND before persistTradingEnv.
    const { db, deps, nodeId } = await mirror();
    await writeNodeMembership(db, heldFencedDoc(nodeId, "sell-only"));
    const persisted: string[] = [];
    const err = await captureError(() =>
      promoteMirrorToPrimary(
        deps(noopLog, async (seriesId) => {
          persisted.push(seriesId);
        }),
        { oldNodeNeutralised: true },
      ),
    );
    expect(isAppError(err) && err.code).toBe("promotion.node_fenced");
    expect(isAppError(err) && err.params).toEqual({ standing: "sell-only" });
    expect(await readDeploymentMode(db, nodeId)).toBe("mirror"); // never promoted
    expect(await readSingletonRole(db, nodeId)).toBe("secondary");
    expect((await readNodeMembership(db))?.body.term).toBe(3); // no re-mint
    expect(persisted).toEqual([]); // the fence refusal is before persistTradingEnv
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
      withTransaction(db, (tx) => commitMirrorPromotionTx(tx, nodeId, docAtTerm(4, nodeId))),
    );
    expect(isAppError(err) && err.code).toBe("promotion.membership_superseded");
    // The whole PONR rolled back: the held term is untouched and the node is still a mirror — the flip
    // did NOT commit against the superseded chart.
    expect((await readNodeMembership(db))?.body.term).toBe(5);
    expect(await readDeploymentMode(db, nodeId)).toBe("mirror");
    expect(await readSingletonRole(db, nodeId)).toBe("secondary");
  });

  it("mints a first chart naming only itself, with no endorsement, when the mirror holds neither", async () => {
    const { db, deps, nodeId } = await mirror(); // NB: no writeNodeMembership seed
    await db.execute(sql`update nodes set endorsement = null where id = ${nodeId}`);

    const result = await promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true });

    expect(result.alreadyPrimary).toBe(false);
    const held = await readNodeMembership(db);
    expect(held?.body).toEqual({
      term: 0,
      nodes: [{ nodeId, contactUrl: "", standing: "serving-primary" }],
    });
    expect(held?.signerNodeId).toBe(nodeId);
    expect(held?.endorsements).toEqual([]);
  });

  it("reports a held term of -1 when the refused membership write leaves no chart held at all", async () => {
    const { db, nodeId } = await mirror();
    // Stands in for the held row vanishing under the write: the engine skips the insert.
    await db.execute(
      sql`create trigger promote_skip_membership before insert on node_membership begin select raise(ignore); end`,
    );
    let err: unknown;
    try {
      err = await captureError(() =>
        withTransaction(db, (tx) => commitMirrorPromotionTx(tx, nodeId, docAtTerm(4, nodeId))),
      );
    } finally {
      await db.execute(sql`drop trigger promote_skip_membership`);
    }
    expect(isAppError(err) && err.code).toBe("promotion.membership_superseded");
    expect(isAppError(err) && err.params).toEqual({ heldTerm: -1, mintedTerm: 4 });
    expect(await readDeploymentMode(db, nodeId)).toBe("mirror");
  });
});
