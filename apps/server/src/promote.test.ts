import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { isAppError, locationId as brandLocationId } from "@waitron/shared";
import {
  captureError,
  CORE_MIGRATIONS,
  locations,
  nodes,
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
  endorseKey,
  generateNodeKeyPair,
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

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const noopLog: PromoteDeps["log"] = () => {};

// Promote reads only the held term and node list, never the signature, so a placeholder serves.
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

// A fenced node has the same `(primary, secondary)` axis pair as a healthy local secondary, so only
// the fence check can refuse it.
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
  // Declared inside the describe so its hooks do not fire around the mirror block's cases. The
  // per-test reset matters: the term-0 mint case fails when it sees an earlier case's rows.
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
    const [loc] = await db
      .insert(locations)
      .values({
        name: "Barra",
        invoiceLocales: ["es-ES"],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    const nodeId = await seedNode(db, brandLocationId(loc!.id));
    await setSingletonRole(db, nodeId, "secondary");
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
    expect(await readSingletonRole(db, nodeId)).toBe("secondary");
  });

  it("claims the singletons and flips the holder so the fiscal pass starts", async () => {
    const { db, deps, nodeId } = await localSecondary();
    const d = deps(noopLog);

    // The same pass, built once over the holder, must flip from empty to real with no restart.
    const pass = singletonPass(
      () => d.holders.singletonRole.current,
      async () => ({
        nextDueAt: null,
        duties: [{ duty: DRAIN_DUTY, ok: true, nextDueAt: null, durationMs: 0 }],
      }),
    );
    expect(await pass(new Date())).toEqual({ nextDueAt: null, duties: [] });

    const result = await promoteLocalSecondaryToPrimary(d, { oldNodeNeutralised: true });
    expect(result).toEqual({ alreadyPrimary: false });
    expect(await readSingletonRole(db, nodeId)).toBe("primary");
    expect(d.holders.singletonRole.current).toBe("primary");
    expect((await pass(new Date())).duties.map((r) => r.duty)).toContain(DRAIN_DUTY);
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
    expect(held?.body.term).toBe(4);
    const standings = Object.fromEntries(held!.body.nodes.map((n) => [n.nodeId, n.standing]));
    expect(standings[nodeId]).toBe("serving-primary");
    expect(standings[oldNodeId]).toBe("sell-only");
    // `routableServers` drops a node with an empty `contactUrl`, and a till may still dial a
    // `sell-only` node.
    const oldNode = held!.body.nodes.find((n) => n.nodeId === oldNodeId);
    expect(oldNode?.contactUrl).toBe("https://old");
    const bystander = held!.body.nodes.find((n) => n.nodeId === bystanderId);
    expect(bystander).toEqual({
      nodeId: bystanderId,
      contactUrl: "https://bystander",
      standing: "sell-only",
    });

    const trust = await readMembershipTrustSet(db);
    const verdict = verifyMembershipDocument(held!, trust);
    expect(verdict.valid).toBe(true);
    expect(held!.signerNodeId).toBe(nodeId);
    expect(held!.endorsements).toEqual([]);
  });

  it("carries this node's stored endorsement, so a peer trusting only the endorser accepts the new term", async () => {
    const { db, deps, nodeId } = await localSecondary();
    const oldNodeId = "old-node-1";
    const endorser = generateNodeKeyPair();
    const ownKey = (await readMembershipTrustSet(db))[nodeId]!;
    const endorsement = endorseKey(nodeId, ownKey, oldNodeId, endorser.privateKey);
    await db.update(nodes).set({ endorsement }).where(eq(nodes.id, nodeId));
    await writeNodeMembership(db, heldTermThreeDoc(nodeId, oldNodeId));

    await promoteLocalSecondaryToPrimary(deps(noopLog), { oldNodeNeutralised: true });

    const held = (await readNodeMembership(db))!;
    expect(held.endorsements).toEqual([endorsement]);
    const byEndorser = verifyMembershipDocument(held, { [oldNodeId]: endorser.publicKey });
    expect(byEndorser.valid ? "valid" : byEndorser.reason).toBe("valid");
    const direct = verifyMembershipDocument(held, { [nodeId]: ownKey });
    expect(direct.valid ? "valid" : direct.reason).toBe("valid");
  });

  it("mints a term-0 document naming this node when NO membership document is held", async () => {
    // No held document: this node must still be appended as serving-primary.
    const { db, deps, nodeId } = await localSecondary();

    const result = await promoteLocalSecondaryToPrimary(deps(noopLog), {
      oldNodeNeutralised: true,
    });
    expect(result.alreadyPrimary).toBe(false);

    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(0);
    expect(held?.body.nodes).toEqual([{ nodeId, contactUrl: "", standing: "serving-primary" }]);
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
    expect(second.alreadyPrimary).toBe(true);
    expect((await readNodeMembership(db))?.body.term).toBe(4);
  });

  it("refuses a fenced (sell-only) node with promotion.node_fenced and writes nothing", async () => {
    const { db, deps, nodeId } = await localSecondary();
    await writeNodeMembership(db, heldFencedDoc(nodeId, "sell-only"));
    const error = await captureError(() =>
      promoteLocalSecondaryToPrimary(deps(noopLog), { oldNodeNeutralised: true }),
    );
    expect(isAppError(error) && error.code).toBe("promotion.node_fenced");
    expect(isAppError(error) && error.params).toEqual({ standing: "sell-only" });
    expect(await readSingletonRole(db, nodeId)).toBe("secondary");
    expect((await readNodeMembership(db))?.body.term).toBe(3);
  });

  it("refuses a fenced (evicted) node with promotion.node_fenced and writes nothing", async () => {
    const { db, deps, nodeId } = await localSecondary();
    await writeNodeMembership(db, heldFencedDoc(nodeId, "evicted"));
    const error = await captureError(() =>
      promoteLocalSecondaryToPrimary(deps(noopLog), { oldNodeNeutralised: true }),
    );
    expect(isAppError(error) && error.code).toBe("promotion.node_fenced");
    expect(isAppError(error) && error.params).toEqual({ standing: "evicted" });
    expect(await readSingletonRole(db, nodeId)).toBe("secondary");
    expect((await readNodeMembership(db))?.body.term).toBe(3);
  });

  it("refuses a mirror with promotion.not_a_local_secondary before any write", async () => {
    // The mirror guard returns before any identity read, so none is established.
    const db = suite.db;
    const nodeId = "n";
    await stampDeployment(db, "preproduction");
    await setDeploymentMode(db, nodeId, "mirror");
    const holders = createDeploymentHolders("mirror", "secondary");
    const error = await captureError(() =>
      promoteLocalSecondaryToPrimary(
        { db, holders, log: noopLog, ring: RING, nodeId },
        { oldNodeNeutralised: true },
      ),
    );
    expect(isAppError(error) && error.code).toBe("promotion.not_a_local_secondary");
    expect(await readSingletonRole(db, nodeId)).toBe("secondary");
  });
});

function docAtTerm(term: number, nodeId: string): SignedMembershipDocument {
  return {
    body: { term, nodes: [{ nodeId, contactUrl: "", standing: "serving-primary" }] },
    signerNodeId: nodeId,
    signature: "placeholder-sig",
    endorsements: [],
  };
}

describe("promoteMirrorToPrimary", () => {
  // The full manifest, because `establishReservedStandbyIdentity` writes the reserved SIF. Declared
  // inside the describe, and reset per test, for the reasons the local-secondary block states.
  const suite = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });

  // A mirror already holding its reserved identity, established as the adopt path does.
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
    await setDeploymentMode(db, standby.nodeId, "mirror");
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
    await writeNodeMembership(db, heldTermThreeDoc(nodeId, "old-primary", []));

    const result = await promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true });

    expect(result.alreadyPrimary).toBe(false);
    expect(result.seriesId).toBe(standardSeriesId);
    expect(await readDeploymentMode(db, nodeId)).toBe("primary");
    expect(await readSingletonRole(db, nodeId)).toBe("primary");

    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(4);
    const standings = Object.fromEntries(held!.body.nodes.map((n) => [n.nodeId, n.standing]));
    expect(standings[nodeId]).toBe("serving-primary");
    expect(standings["old-primary"]).toBe("sell-only");
    expect(held!.signerNodeId).toBe(nodeId);
    expect(held!.endorsements).toEqual([endorsement]);
  });

  it("persists the corrected trading.env BEFORE the point-of-no-return (a persist failure aborts the flip)", async () => {
    // A persist that throws must leave the node a mirror; had the flip run first, it would be primary.
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
    expect(persisted).toEqual([standardSeriesId]);
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
    expect(await readDeploymentMode(db, nodeId)).toBe("mirror");
    expect(persisted).toEqual([]);
  });

  it("is idempotent — a second promote on an already-primary node is a no-op", async () => {
    const { db, deps, nodeId } = await mirror();
    await writeNodeMembership(db, heldTermThreeDoc(nodeId, "old-primary"));

    const first = await promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true });
    const second = await promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true });

    expect(second.alreadyPrimary).toBe(true);
    expect(first.seriesId).toBe(second.seriesId);
    expect((await readNodeMembership(db))?.body.term).toBe(4);
  });

  it("refuses a fenced node with promotion.node_fenced, leaving it a mirror and persisting nothing", async () => {
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
    expect(await readDeploymentMode(db, nodeId)).toBe("mirror");
    expect(await readSingletonRole(db, nodeId)).toBe("secondary");
    expect((await readNodeMembership(db))?.body.term).toBe(3);
    expect(persisted).toEqual([]);
  });

  it("aborts the whole PONR with promotion.membership_superseded when a newer term raced in", async () => {
    // Stands in for a gossip adoption landing a newer term between the mint and the commit: a stale
    // document against a held term 5.
    const { db, nodeId } = await mirror();
    await writeNodeMembership(db, docAtTerm(5, nodeId));

    const err = await captureError(() =>
      withTransaction(db, (tx) => commitMirrorPromotionTx(tx, nodeId, docAtTerm(4, nodeId))),
    );
    expect(isAppError(err) && err.code).toBe("promotion.membership_superseded");
    expect((await readNodeMembership(db))?.body.term).toBe(5);
    expect(await readDeploymentMode(db, nodeId)).toBe("mirror");
    expect(await readSingletonRole(db, nodeId)).toBe("secondary");
  });

  it("mints a first chart naming only itself, with no endorsement, when the mirror holds neither", async () => {
    const { db, deps, nodeId } = await mirror();
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
