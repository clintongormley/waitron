import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  captureError,
  deployment,
  stampDeployment,
  readNodeMembership,
  readStandardSeriesId,
  withTransaction,
  writeNodeMembership,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import { readHandoverEvents, readNodeMode, setNodeMode } from "@waitron/node-db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import {
  generateNodeKeyPair,
  MAX_NODES,
  signDocumentBody,
  type Endorsement,
  type MembershipDocumentBody,
  type NodeKeyPair,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { createDeploymentHolders } from "./deployment-holders.js";
import { seedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { nodeId as brandNodeId } from "@waitron/shared";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";
import { sealAdoptedStandbyKey } from "./testing/adopted-standby-key.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { tableSnapshot } from "./testing/table-snapshot.js";
import {
  commitMirrorPromotionTx,
  promoteMirrorToPrimary,
  type MirrorPromoteDeps,
  type PromoteDeps,
} from "./promote.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const noopLog: PromoteDeps["log"] = () => {};

type LogEntry = { level: string; event: string; detail: unknown };

function recordingLog(): { log: PromoteDeps["log"]; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    entries,
    log: (level, event, detail) => {
      entries.push({ level, event, detail });
    },
  };
}

// The node handle that refuses its next write lock without running the write, so nothing is
// written. Reads before that go through; with `readsFailAfter`, every call after it throws.
function nodeFailingNextWrite(
  node: NodeDatabase,
  { readsFailAfter = false }: { readsFailAfter?: boolean } = {},
): NodeDatabase {
  let failed = false;
  return new Proxy(node, {
    get(target, property, receiver) {
      if (property === "withWriteLock" && !failed) {
        return () => {
          failed = true;
          return Promise.reject(new Error("node.db write refused"));
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      if (failed && readsFailAfter) {
        return () => {
          throw new Error("node.db read refused");
        };
      }
      return value.bind(target);
    },
  });
}

// A real key pair per signer id, so a held chart verifies against the key its box pins.
const signerKeys = new Map<string, NodeKeyPair>();
function signerKey(nodeId: string): NodeKeyPair {
  let key = signerKeys.get(nodeId);
  if (key === undefined) {
    key = generateNodeKeyPair();
    signerKeys.set(nodeId, key);
  }
  return key;
}

function signedBy(signerNodeId: string, body: MembershipDocumentBody): SignedMembershipDocument {
  return {
    body,
    signerNodeId,
    signature: signDocumentBody(body, signerKey(signerNodeId).privateKey),
    endorsements: [],
  };
}

/** Holds `doc`, pinning its signer's key as adopt pins the main box's, unless self-signed. */
async function holdChart(
  db: Database,
  node: NodeDatabase,
  boxId: string,
  doc: SignedMembershipDocument,
): Promise<void> {
  await writeNodeMembership(db, doc);
  if (doc.signerNodeId === boxId) return;
  await pinMainBoxKey(node, boxId, {
    nodeId: doc.signerNodeId,
    publicKey: signerKey(doc.signerNodeId).publicKey,
  });
}

function heldTermThreeDoc(nodeId: string, oldNodeId: string): SignedMembershipDocument {
  return signedBy(oldNodeId, {
    term: 3,
    nodes: [
      { nodeId: oldNodeId, contactUrl: "https://old", standing: "serving-primary" },
      { nodeId, contactUrl: "", standing: "serving-secondary" },
    ],
  });
}

/** A signed chart whose body was rewritten to one with no `nodes` list, as an outside edit leaves it. */
function unreadableChart(nodeId: string, signerNodeId: string): SignedMembershipDocument {
  const doc = heldTermThreeDoc(nodeId, signerNodeId);
  return { ...doc, body: { term: 3 } } as unknown as SignedMembershipDocument;
}

function heldFencedDoc(
  nodeId: string,
  standing: "sell-only" | "evicted",
  carrierNodeId = "carrier-node",
): SignedMembershipDocument {
  return signedBy(carrierNodeId, {
    term: 3,
    nodes: [
      { nodeId: carrierNodeId, contactUrl: "https://carrier", standing: "serving-primary" },
      { nodeId, contactUrl: "", standing },
    ],
  });
}

function docAtTerm(term: number, nodeId: string): SignedMembershipDocument {
  return signedBy(nodeId, {
    term,
    nodes: [{ nodeId, contactUrl: "", standing: "serving-primary" }],
  });
}

describe("promoteMirrorToPrimary", () => {
  // The full manifest, because `establishReservedStandbyIdentity` writes the reserved SIF.
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
    deps: (log: PromoteDeps["log"]) => MirrorPromoteDeps;
  }> {
    const db = suite.db;
    await stampDeployment(db, "preproduction");
    await seedVenue(db, {
      name: "Barra",
      invoiceLocales: ["es-ES"],
    });
    const t = await db.execute<{ tax_id: string }>(sql`select tax_id from taxpayer where id = 1`);
    const nif = t.rows[0]!.tax_id;

    const standby = generateStandbyIdentity();
    signerKeys.set(standby.nodeId, {
      publicKey: standby.publicKey,
      privateKey: standby.privateKey,
    });
    await sealAdoptedStandbyKey(suite.node, RING, standby);
    await setNodeMode({ venue: db, node: suite.node }, standby.nodeId, "mirror", "adopt");
    const endorsement: Endorsement = {
      nodeId: standby.nodeId,
      publicKey: standby.publicKey,
      endorsedBy: "primary-node",
      signature: "endorsement-sig",
    };
    await establishReservedStandbyIdentity(
      { ownerDb: db },
      {
        standby,
        nodeName: "cloud",
        filingModule: "verifactu",
        taxModule: "vat",
        modules: [],
        reserved: {
          modules: {
            "fiscal-verifactu": { nif, idSistemaInformatico: "W1", numeroInstalacion: 7 },
          },
          series: [
            { code: "FA-7", purpose: "standard" },
            { code: "FF-7", purpose: "full" },
            { code: "FR-7", purpose: "corrective" },
          ],
          endorsement,
        },
      },
    );
    await withTransaction(db, (tx) =>
      seedFixtureSif(tx, {
        nodeId: brandNodeId(standby.nodeId),
        nif,
        idSistemaInformatico: "W1",
        numeroInstalacion: "7",
      }),
    );
    const standardSeriesId = await readStandardSeriesId(db, standby.nodeId);
    const holders = createDeploymentHolders("mirror", "secondary");
    return {
      db,
      nodeId: standby.nodeId,
      standardSeriesId,
      endorsement,
      deps: (log) => ({
        db,
        node: suite.node,
        holders,
        log,
        ring: RING,
        nodeId: standby.nodeId,
      }),
    };
  }

  it("flips mode+singleton to primary, mints an endorsed term-bumped doc, and returns the validated standard seriesId", async () => {
    const { db, deps, nodeId, standardSeriesId, endorsement } = await mirror();
    await holdChart(db, suite.node, nodeId, heldTermThreeDoc(nodeId, "old-primary"));

    const result = await promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true });

    expect(result.alreadyPrimary).toBe(false);
    expect(result.seriesId).toBe(standardSeriesId);
    expect((await readNodeMode(suite.node, nodeId)).mode).toBe("primary");
    expect((await readNodeMode(suite.node, nodeId)).singletonRole).toBe("primary");

    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(4);
    const standings = Object.fromEntries(held!.body.nodes.map((n) => [n.nodeId, n.standing]));
    expect(standings[nodeId]).toBe("serving-primary");
    expect(standings["old-primary"]).toBe("sell-only");
    expect(held!.signerNodeId).toBe(nodeId);
    expect(held!.endorsements).toEqual([endorsement]);
    const events = await readHandoverEvents(suite.node, nodeId, null, "box.role_changed");
    expect(events.map(({ detail }) => detail)).toEqual([
      { mode: "mirror", singletonRole: "secondary", cause: "adopt" },
      { mode: "primary", singletonRole: "primary", cause: "promote" },
    ]);
  });

  it("refuses promotion before changing roles when the mirror has no full invoice series", async () => {
    const { db, deps, nodeId } = await mirror();
    await holdChart(db, suite.node, nodeId, heldTermThreeDoc(nodeId, "old-primary"));
    await db.execute(
      sql`update invoice_series set retired_at = current_timestamp where node_id = ${nodeId} and purpose = 'full'`,
    );

    const error = await captureError(() =>
      promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true }),
    );

    expect(isAppError(error) && error.code).toBe("series.no_full_for_node");
    expect((await readNodeMode(suite.node, nodeId)).mode).toBe("mirror");
    expect((await readNodeMode(suite.node, nodeId)).singletonRole).toBe("secondary");
  });

  it("refuses without a fence attestation, leaving the node a mirror", async () => {
    const { deps, nodeId } = await mirror();
    const err = await captureError(() =>
      promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: false }),
    );
    expect(isAppError(err) && err.code).toBe("promotion.fence_not_attested");
    expect((await readNodeMode(suite.node, nodeId)).mode).toBe("mirror");
  });

  it("is idempotent — a second promote on an already-primary node is a no-op", async () => {
    const { db, deps, nodeId } = await mirror();
    await holdChart(db, suite.node, nodeId, heldTermThreeDoc(nodeId, "old-primary"));

    const first = await promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true });
    const events = await readHandoverEvents(suite.node, nodeId, null, "box.role_changed");
    const second = await promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true });

    expect(second.alreadyPrimary).toBe(true);
    expect(first.seriesId).toBe(second.seriesId);
    expect((await readNodeMembership(db))?.body.term).toBe(4);
    expect(await readHandoverEvents(suite.node, nodeId, null, "box.role_changed")).toEqual(events);
  });

  it("refuses a fenced node with promotion.node_fenced, leaving it a mirror", async () => {
    const { db, deps, nodeId } = await mirror();
    await holdChart(db, suite.node, nodeId, heldFencedDoc(nodeId, "sell-only"));
    const err = await captureError(() =>
      promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true }),
    );
    expect(isAppError(err) && err.code).toBe("promotion.node_fenced");
    expect(isAppError(err) && err.params).toEqual({ standing: "sell-only" });
    expect((await readNodeMode(suite.node, nodeId)).mode).toBe("mirror");
    expect((await readNodeMode(suite.node, nodeId)).singletonRole).toBe("secondary");
    expect((await readNodeMembership(db))?.body.term).toBe(3);
  });

  // Covers only a machine whose OWN held chart contains the clearing. A standby that never finished
  // joining never receives the primary's later charts, so on such a machine this check does not see
  // the clearing; the primary's join refusal (`mirror.standby_removed`) is what refuses it.
  it("refuses a machine its own held chart has cleared (revoked) with promotion.node_fenced, leaving it a mirror", async () => {
    const { db, deps, nodeId } = await mirror();
    await holdChart(
      db,
      suite.node,
      nodeId,
      signedBy("carrier-node", {
        term: 3,
        nodes: [
          { nodeId: "carrier-node", contactUrl: "https://carrier", standing: "serving-primary" },
        ],
        revoked: [nodeId],
      }),
    );
    const err = await captureError(() =>
      promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true }),
    );
    expect(isAppError(err) && err.code).toBe("promotion.node_fenced");
    expect(isAppError(err) && err.params).toEqual({ standing: "evicted" });
    expect((await readNodeMode(suite.node, nodeId)).mode).toBe("mirror");
    expect((await readNodeMembership(db))?.body.term).toBe(3);
  });

  it("refuses with membership.chart_too_large, leaving it a mirror, when its held chart lists MAX_NODES machines but not itself", async () => {
    const { db, deps, nodeId } = await mirror();
    await holdChart(
      db,
      suite.node,
      nodeId,
      signedBy("other-0", {
        term: 3,
        nodes: Array.from({ length: MAX_NODES }, (_, i) => ({
          nodeId: `other-${i}`,
          contactUrl: `https://other-${i}`,
          standing: i === 0 ? ("serving-primary" as const) : ("serving-secondary" as const),
        })),
      }),
    );
    const err = await captureError(() =>
      promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true }),
    );
    expect(isAppError(err) && err.code).toBe("membership.chart_too_large");
    expect((await readNodeMode(suite.node, nodeId)).mode).toBe("mirror");
    expect((await readNodeMembership(db))?.body.term).toBe(3);
  });

  it("aborts the whole PONR with promotion.membership_superseded when a newer term raced in", async () => {
    // Stands in for a gossip adoption landing a newer term between the mint and the commit: a stale
    // document against a held term 5.
    const { db, nodeId } = await mirror();
    await writeNodeMembership(db, docAtTerm(5, nodeId));

    const err = await captureError(() =>
      withTransaction(db, (tx) => commitMirrorPromotionTx(tx, docAtTerm(4, nodeId))),
    );
    expect(isAppError(err) && err.code).toBe("promotion.membership_superseded");
    expect((await readNodeMembership(db))?.body.term).toBe(5);
    expect((await readNodeMode(suite.node, nodeId)).mode).toBe("mirror");
    expect((await readNodeMode(suite.node, nodeId)).singletonRole).toBe("secondary");
  });

  it("a refused membership write leaves node.db's role untouched", async () => {
    const { db, deps, nodeId } = await mirror();
    await holdChart(db, suite.node, nodeId, heldTermThreeDoc(nodeId, "old-primary"));

    // A newer term lands between the mint and the venue save, as a gossip adoption would.
    const err = await captureError(() =>
      promoteMirrorToPrimary(
        {
          ...deps(noopLog),
          withModuleOperations: async (_context, run) => {
            await writeNodeMembership(db, docAtTerm(5, nodeId));
            return withTransaction(db, (tx) => run(tx, new Map()));
          },
        },
        { oldNodeNeutralised: true },
      ),
    );

    expect(isAppError(err) && err.code).toBe("promotion.membership_superseded");
    expect((await readNodeMembership(db))?.body.term).toBe(5);
    expect(await readNodeMode(suite.node, nodeId)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
  });

  it("a role write that fails after the venue save is logged and still asks for a restart", async () => {
    const { db, deps, nodeId, standardSeriesId } = await mirror();
    await holdChart(db, suite.node, nodeId, heldTermThreeDoc(nodeId, "old-primary"));
    const { log, entries } = recordingLog();

    const result = await promoteMirrorToPrimary(
      { ...deps(log), node: nodeFailingNextWrite(suite.node) },
      { oldNodeNeutralised: true },
    );

    expect(result).toEqual({ alreadyPrimary: false, seriesId: standardSeriesId });
    expect(entries.filter((entry) => entry.event === "promotion.role_write_failed")).toEqual([
      {
        level: "warn",
        event: "promotion.role_write_failed",
        detail: { errorCode: "unknown", error: "node.db write refused" },
      },
    ]);
    expect(entries.map((entry) => entry.event)).not.toContain("promotion.completed");
    expect((await readNodeMembership(db))?.body.term).toBe(4);
    expect(await readNodeMode(suite.node, nodeId)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
  });

  it("a second call after a lost role write finishes the role and mints no second term", async () => {
    const { db, deps, nodeId, standardSeriesId } = await mirror();
    await holdChart(db, suite.node, nodeId, heldTermThreeDoc(nodeId, "old-primary"));
    const { log, entries } = recordingLog();

    const first = await promoteMirrorToPrimary(
      { ...deps(log), node: nodeFailingNextWrite(suite.node) },
      { oldNodeNeutralised: true },
    );
    expect(first).toEqual({ alreadyPrimary: false, seriesId: standardSeriesId });
    const termAfterFirst = (await readNodeMembership(db))?.body.term;

    const d = deps(log);
    const second = await promoteMirrorToPrimary(d, { oldNodeNeutralised: true });

    expect(second).toEqual({ alreadyPrimary: false, seriesId: standardSeriesId });
    expect(await readNodeMode(suite.node, nodeId)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
    expect(d.holders.mode.current).toBe("primary");
    expect((await readNodeMembership(db))?.body.term).toBe(termAfterFirst);
    expect(entries.map((entry) => entry.event)).toContain("promotion.role_finished");
  });

  it("still asks for a restart when node.db can be neither written nor read after the venue save", async () => {
    const { db, deps, nodeId, standardSeriesId } = await mirror();
    await holdChart(db, suite.node, nodeId, heldTermThreeDoc(nodeId, "old-primary"));
    const promoteDeps = {
      ...deps(noopLog),
      node: nodeFailingNextWrite(suite.node, { readsFailAfter: true }),
    };

    const result = await promoteMirrorToPrimary(promoteDeps, { oldNodeNeutralised: true });

    expect(result).toEqual({ alreadyPrimary: false, seriesId: standardSeriesId });
    expect((await readNodeMembership(db))?.body.term).toBe(4);
    expect(promoteDeps.holders.mode.current).toBe("mirror");
    expect(promoteDeps.holders.singletonRole.current).toBe("secondary");
  });

  it("refuses an unstamped venue.db with deployment.not_stamped before activating or persisting anything", async () => {
    const { db, deps, nodeId } = await mirror();
    await holdChart(db, suite.node, nodeId, heldTermThreeDoc(nodeId, "old-primary"));
    await db.delete(deployment);
    const activate = vi.fn(async () => {});
    const activating = fakeModule("activating-regime", {
      provisioning: {
        standby: { reserve: async () => ({ state: {} }), establish: async () => {}, activate },
      },
    });

    const error = await captureError(() =>
      promoteMirrorToPrimary(
        { ...deps(noopLog), modules: [activating] },
        { oldNodeNeutralised: true },
      ),
    );

    expect(isAppError(error) && error.code).toBe("deployment.not_stamped");
    expect(activate).not.toHaveBeenCalled();
    expect((await readNodeMembership(db))?.body.term).toBe(3);
    expect(await readNodeMode(suite.node, nodeId)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
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

  it("refuses to sign over a held document no stored key vouches for, writing nothing", async () => {
    const { db, deps, nodeId } = await mirror();
    await writeNodeMembership(db, heldTermThreeDoc(nodeId, "unpinned-old-primary"));
    const err = await captureError(() =>
      promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true }),
    );
    expect(isAppError(err) && err.code).toBe("membership.held_untrusted");
    expect(isAppError(err) && err.params).toEqual({ reason: "untrusted_signer" });
    expect((await readNodeMembership(db))?.body.term).toBe(3);
    expect(await readNodeMode(suite.node, nodeId)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
  });

  it("still refuses a malformed held document signed by a key no stored key vouches for", async () => {
    const { db, deps, nodeId } = await mirror();
    const doc = heldTermThreeDoc(nodeId, "unpinned-old-primary");
    const body = { ...doc.body, revoked: ["gone", "gone"] };
    await writeNodeMembership(db, signedBy("unpinned-old-primary", body));
    const err = await captureError(() =>
      promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true }),
    );
    expect(isAppError(err) && err.code).toBe("membership.held_untrusted");
    expect(isAppError(err) && err.params).toEqual({ reason: "untrusted_signer" });
    expect((await readNodeMembership(db))?.body.term).toBe(3);
    expect((await readNodeMode(suite.node, nodeId)).mode).toBe("mirror");
  });

  it("refuses a held document no stored key vouches for that carries an unsigned field beside its body", async () => {
    const { db, deps, nodeId } = await mirror();
    const doc = { ...heldTermThreeDoc(nodeId, "unpinned-old-primary"), note: "x" };
    await writeNodeMembership(db, doc as SignedMembershipDocument);
    const err = await captureError(() =>
      promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true }),
    );
    expect(isAppError(err) && err.code).toBe("membership.held_untrusted");
    expect(isAppError(err) && err.params).toEqual({ reason: "untrusted_signer" });
    expect((await readNodeMembership(db))?.body.term).toBe(3);
    expect((await readNodeMode(suite.node, nodeId)).mode).toBe("mirror");
  });

  it("refuses a held chart whose body is not a membership chart with reason malformed, writing nothing", async () => {
    const { db, deps, nodeId } = await mirror();
    await writeNodeMembership(db, unreadableChart(nodeId, "unpinned-old-primary"));
    const before = [await tableSnapshot(db), await tableSnapshot(suite.node)];
    const err = await captureError(() =>
      promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true }),
    );
    expect(isAppError(err) && err.code).toBe("membership.held_untrusted");
    expect(isAppError(err) && err.params).toEqual({ reason: "malformed" });
    expect([await tableSnapshot(db), await tableSnapshot(suite.node)]).toEqual(before);
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
        withTransaction(db, (tx) => commitMirrorPromotionTx(tx, docAtTerm(4, nodeId))),
      );
    } finally {
      await db.execute(sql`drop trigger promote_skip_membership`);
    }
    expect(isAppError(err) && err.code).toBe("promotion.membership_superseded");
    expect(isAppError(err) && err.params).toEqual({ heldTerm: -1, mintedTerm: 4 });
    expect((await readNodeMode(suite.node, nodeId)).mode).toBe("mirror");
  });
});
