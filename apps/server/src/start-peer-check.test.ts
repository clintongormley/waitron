import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  nodes,
  readNodeMembership,
  withNodeTransaction,
  withTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb, type VenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing } from "@waitron/credentials";
import { insertHandoverActivationTx, signEnvelope, type HandoverState } from "@waitron/handover";
import {
  generateNodeKeyPair,
  signDocumentBody,
  type MembershipDocumentBody,
  type NodeStanding,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  nodeHandoverEvents,
  nodeHandoverOperations,
  readHandoverOperation,
  readHandoverRestriction,
  recordHandoverRestrictionTx,
  setNodeModeTx,
  writeMirrorLink,
} from "@waitron/node-db";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import type { PeerOperationStatus, PeerStatusBody } from "./peer-status-api.js";
import {
  closeSupersededOperation,
  readActivatedFrom,
  recordSupersededAtStart,
  repairAtStart,
  runStartPeerCheck,
  successorAfterCheck,
} from "./start-peer-check.js";
import {
  mintBoxAuthority,
  startBoxServer,
  type BoxAuthority,
  type BoxServer,
} from "./testing/box-authority.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { setupVenue } from "./testing/venue-fixtures.js";

const migrations = migrationOptionsFor(manifestSets(), null);
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const PEER = { nodeId: "00000000-0000-4000-8000-0000000000cc", ...generateNodeKeyPair() };
const OWN_URL = "https://box.example";
const PEER_URL = "https://peer.example";
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
// Holds no `tls/ca.crt`: a box with no venue authority to check a peer under.
const NO_STATE_DIR = join(tmpdir(), "start-peer-check-no-state");

interface Box {
  nodeId: string;
  held: SignedMembershipDocument;
  chart(term: number, entries: [string, NodeStanding, string][]): SignedMembershipDocument;
}

/** A set-up box whose held chart lists it and PEER; `joined` adds PEER's `nodes` row. */
async function box(
  suite: VenueDb,
  options: {
    joined?: boolean;
    peerUrl?: string;
    peerStanding?: NodeStanding;
    /** Sign the held chart with the peer's key, so it is not this box's own promotion chart. */
    heldSignedByPeer?: boolean;
  } = {},
): Promise<Box> {
  const venue = await setupVenue(suite.db);
  const nodeId = venue.cfg.nodeId;
  await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring: RING }, nodeId);
  // Stands in for A947 3b's join step, which must make the chart vouch for a joined box's key.
  await pinMainBoxKey(suite.node, nodeId, PEER);
  if (options.joined !== false) {
    await suite.db.insert(nodes).values({
      id: PEER.nodeId,
      name: "Spare",
      publicKey: PEER.publicKey,
    });
  }
  const privateKey = await readNodeIdentityKey(suite.node, RING, nodeId);
  const chart = (term: number, entries: [string, NodeStanding, string][]) => {
    const body: MembershipDocumentBody = {
      term,
      nodes: entries.map(([id, standing, contactUrl]) => ({ nodeId: id, standing, contactUrl })),
    };
    return {
      body,
      signerNodeId: nodeId,
      signature: signDocumentBody(body, privateKey),
      endorsements: [],
    };
  };
  const own = chart(1, [
    [nodeId, "serving-primary", OWN_URL],
    [PEER.nodeId, options.peerStanding ?? "serving-secondary", options.peerUrl ?? PEER_URL],
  ]);
  const held =
    options.heldSignedByPeer === true
      ? {
          ...own,
          signerNodeId: PEER.nodeId,
          signature: signDocumentBody(own.body, PEER.privateKey),
        }
      : own;
  await writeNodeMembership(suite.db, held);
  return { nodeId, held, chart };
}

type PeerAnswer = (nonce: string) => Partial<PeerStatusBody>;

/** PEER's side of the wire: a signed status built from `answer`, or no answer at all. */
function peerFetch(answer: PeerAnswer | "silent") {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (answer === "silent") throw new Error("connect ECONNREFUSED");
    expect(String(url)).toBe(`${PEER_URL}/api/node/peer-status`);
    const query = JSON.parse(String(init?.body)) as { purpose: string; body: { nonce: string } };
    expect(query.purpose).toBe("waitron.handover.query.v1");
    const nonce = query.body.nonce;
    const body: PeerStatusBody = {
      nonce,
      heldMembership: null,
      restriction: null,
      openOperation: null,
      requestedOperation: null,
      ...answer(nonce),
    };
    return new Response(JSON.stringify(signEnvelope("status", body as never, PEER)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

async function insertOperation(
  suite: VenueDb,
  nodeId: string,
  row: {
    operationId?: string;
    role: "source" | "destination";
    scenario?: "controlled" | "emergency";
    state: HandoverState;
    sourceNodeId?: string;
    destinationNodeId?: string;
  },
): Promise<void> {
  await withNodeTransaction(suite.node, async (tx) => {
    await tx.insert(nodeHandoverOperations).values({
      nodeId,
      operationId: row.operationId ?? OP,
      role: row.role,
      scenario: row.scenario ?? "controlled",
      sourceNodeId: row.sourceNodeId ?? (row.role === "source" ? nodeId : PEER.nodeId),
      destinationNodeId: row.destinationNodeId ?? (row.role === "source" ? PEER.nodeId : nodeId),
      binding: {},
      fingerprint: "f".repeat(64),
      state: row.state,
      waitingReason: null,
    });
  });
}

function check(
  suite: VenueDb,
  b: Pick<Box, "nodeId">,
  fetch: typeof globalThis.fetch | undefined,
  log = vi.fn(),
  stateDir = NO_STATE_DIR,
) {
  return runStartPeerCheck({
    db: suite.db,
    node: suite.node,
    ring: RING,
    nodeId: b.nodeId,
    stateDir,
    advertisedOrigin: OWN_URL,
    log,
    timeoutMs: 1000,
    ...(fetch === undefined ? {} : { fetch }),
  });
}

describe("the repairs before the start check", () => {
  const suite = useVenueDb({ migrations });

  it("a source operation left at prepared is moved to abandoned, and the box proceeds once its counted peer answers =", async () => {
    const b = await box(suite);
    await insertOperation(suite, b.nodeId, { role: "source", state: "prepared" });
    await repairAtStart({ db: suite.db, node: suite.node, nodeId: b.nodeId });
    expect((await readHandoverOperation(suite.node, b.nodeId, OP))?.state).toBe("abandoned");
    const events = await suite.node.select().from(nodeHandoverEvents);
    expect(events).toMatchObject([{ nodeId: b.nodeId, operationId: OP, kind: "abandoned" }]);
    const outcome = await check(
      suite,
      b,
      peerFetch(() => ({ heldMembership: b.held })),
    );
    expect(outcome.result).toBe("proceed");
  });

  it("records the refusal a repeat of the start request answers", async () => {
    const b = await box(suite);
    await insertOperation(suite, b.nodeId, { role: "source", state: "prepared" });
    await repairAtStart({ db: suite.db, node: suite.node, nodeId: b.nodeId });
    const [event] = await suite.node.select().from(nodeHandoverEvents);
    expect(event!.detail).toEqual({ code: "handover.restarted_before_stepdown", params: {} });
  });

  it("with that peer silent, the box waits", async () => {
    const b = await box(suite);
    await insertOperation(suite, b.nodeId, { role: "source", state: "prepared" });
    await repairAtStart({ db: suite.db, node: suite.node, nodeId: b.nodeId });
    expect((await readHandoverOperation(suite.node, b.nodeId, OP))?.state).toBe("abandoned");
    expect((await check(suite, b, peerFetch("silent"))).result).toBe("wait");
  });

  it("leaves a destination operation at prepared alone", async () => {
    const b = await box(suite);
    await insertOperation(suite, b.nodeId, { role: "destination", state: "prepared" });
    await repairAtStart({ db: suite.db, node: suite.node, nodeId: b.nodeId });
    expect((await readHandoverOperation(suite.node, b.nodeId, OP))?.state).toBe("prepared");
    expect(await suite.node.select().from(nodeHandoverEvents)).toEqual([]);
  });

  it("the restricted start's repair closes a source left at prepared, under the code for what happened", async () => {
    const b = await box(suite);
    await insertOperation(suite, b.nodeId, { role: "source", state: "prepared" });
    await closeSupersededOperation({ node: suite.node, nodeId: b.nodeId }, () => undefined);
    expect((await readHandoverOperation(suite.node, b.nodeId, OP))?.state).toBe("abandoned");
    const [event] = await suite.node.select().from(nodeHandoverEvents);
    expect(event!.detail).toEqual({ code: "handover.superseded_during_start", params: {} });
  });

  it("the restricted start's repair leaves a source that stepped down alone", async () => {
    const b = await box(suite);
    await insertOperation(suite, b.nodeId, { role: "source", state: "source_stepped_down" });
    const logged: string[] = [];
    await closeSupersededOperation({ node: suite.node, nodeId: b.nodeId }, (_level, message) => {
      logged.push(message);
    });
    expect((await readHandoverOperation(suite.node, b.nodeId, OP))?.state).toBe(
      "source_stepped_down",
    );
    expect(await suite.node.select().from(nodeHandoverEvents)).toEqual([]);
    expect(logged).toEqual([]);
  });

  it("the restricted start's repair leaves a destination at prepared alone", async () => {
    const b = await box(suite);
    await insertOperation(suite, b.nodeId, { role: "destination", state: "prepared" });
    await closeSupersededOperation({ node: suite.node, nodeId: b.nodeId }, () => undefined);
    expect((await readHandoverOperation(suite.node, b.nodeId, OP))?.state).toBe("prepared");
    expect(await suite.node.select().from(nodeHandoverEvents)).toEqual([]);
  });

  it("the restricted start's repair logs a failed write and carries on, and a later start closes it", async () => {
    const b = await box(suite);
    await insertOperation(suite, b.nodeId, { role: "source", state: "prepared" });
    suite.node.run(
      sql`create trigger refuse_event before insert on node_handover_events
          begin select raise(abort, 'the write fails here'); end`,
    );
    const logged: [string, string][] = [];
    try {
      await closeSupersededOperation({ node: suite.node, nodeId: b.nodeId }, (level, message) => {
        logged.push([level, message]);
      });
    } finally {
      suite.node.run(sql`drop trigger refuse_event`);
    }
    expect(logged).toEqual([["error", "handover.superseded_close_failed"]]);
    expect((await readHandoverOperation(suite.node, b.nodeId, OP))?.state).toBe("prepared");

    await closeSupersededOperation({ node: suite.node, nodeId: b.nodeId }, () => undefined);
    expect((await readHandoverOperation(suite.node, b.nodeId, OP))?.state).toBe("abandoned");
  });

  it("the restricted start's repair logs a failed read and carries on", async () => {
    const b = await box(suite);
    suite.node.run(sql`alter table node_handover_operations rename to hidden_operations`);
    const logged: string[] = [];
    try {
      await closeSupersededOperation({ node: suite.node, nodeId: b.nodeId }, (_level, message) => {
        logged.push(message);
      });
    } finally {
      suite.node.run(sql`alter table hidden_operations rename to node_handover_operations`);
    }
    expect(logged).toEqual(["handover.superseded_close_failed"]);
  });

  it("leaves a box with no operation alone", async () => {
    const b = await box(suite);
    await repairAtStart({ db: suite.db, node: suite.node, nodeId: b.nodeId });
    expect(await suite.node.select().from(nodeHandoverEvents)).toEqual([]);
  });
});

describe("a destination whose activation committed and whose node.db record was lost", () => {
  const suite = useVenueDb({ migrations });

  async function holdActivationRow(
    nodeId: string,
    row: {
      operationId?: string;
      scenario?: "controlled" | "emergency";
      sourceNodeId?: string;
      destinationNodeId?: string;
    } = {},
  ): Promise<void> {
    const operationId = row.operationId ?? OP;
    await withTransaction(suite.db, (tx) =>
      insertHandoverActivationTx(tx, {
        operationId,
        scenario: row.scenario ?? "controlled",
        sourceNodeId: row.sourceNodeId ?? PEER.nodeId,
        destinationNodeId: row.destinationNodeId ?? nodeId,
        evidence: signEnvelope("status", {} as never, PEER),
        personId: operationId,
        activatedAt: "2026-10-16T12:40:00.000Z",
      }),
    );
  }

  /** A joined box that is neither end of the operation: `handover_activations` keys into `nodes`. */
  const THIRD_BOX = "00000000-0000-4000-8000-0000000000dd";
  async function joinThirdBox(): Promise<void> {
    await suite.db.insert(nodes).values({
      id: THIRD_BOX,
      name: "Third",
      publicKey: generateNodeKeyPair().publicKey,
    });
  }

  async function expectUnrecorded(nodeId: string): Promise<void> {
    expect(await stateOf(nodeId)).toBe("filing_assumed");
    expect(await readActivatedFrom(suite.node, nodeId)).toEqual(new Set());
    expect(await suite.node.select().from(nodeHandoverEvents)).toEqual([]);
  }

  const repair = (nodeId: string) => repairAtStart({ db: suite.db, node: suite.node, nodeId });
  const stateOf = async (nodeId: string) =>
    (await readHandoverOperation(suite.node, nodeId, OP))?.state;

  it.each([
    ["controlled", "filing_assumed"],
    ["emergency", "emergency_declared"],
  ] as const)(
    "%s, at %s, with its row is recorded activated once, and its source joins the set",
    async (scenario, state) => {
      const b = await box(suite);
      await insertOperation(suite, b.nodeId, { role: "destination", scenario, state });
      await holdActivationRow(b.nodeId, { scenario });

      await repair(b.nodeId);
      await repair(b.nodeId);

      expect(await stateOf(b.nodeId)).toBe("activated");
      expect(await readActivatedFrom(suite.node, b.nodeId)).toEqual(new Set([PEER.nodeId]));
      expect(await suite.node.select().from(nodeHandoverEvents)).toMatchObject([
        { nodeId: b.nodeId, operationId: OP, kind: "activated", detail: {}, envelope: null },
      ]);
    },
  );

  it("with no row, a primary box's operation changes nothing", async () => {
    const b = await box(suite);
    await insertOperation(suite, b.nodeId, { role: "destination", state: "filing_assumed" });
    await repair(b.nodeId);
    expect(await stateOf(b.nodeId)).toBe("filing_assumed");
    expect(await readActivatedFrom(suite.node, b.nodeId)).toEqual(new Set());
    expect(await suite.node.select().from(nodeHandoverEvents)).toEqual([]);
  });

  it("a row for another operation changes nothing", async () => {
    const b = await box(suite);
    await insertOperation(suite, b.nodeId, { role: "destination", state: "filing_assumed" });
    await holdActivationRow(b.nodeId, { operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    await repair(b.nodeId);
    expect(await stateOf(b.nodeId)).toBe("filing_assumed");
  });

  it("a row naming another destination leaves the operation unrecorded", async () => {
    const b = await box(suite);
    await joinThirdBox();
    await insertOperation(suite, b.nodeId, { role: "destination", state: "filing_assumed" });
    await holdActivationRow(b.nodeId, { destinationNodeId: THIRD_BOX });
    await repair(b.nodeId);
    await expectUnrecorded(b.nodeId);
  });

  it("a row naming another source leaves the operation unrecorded", async () => {
    const b = await box(suite);
    await joinThirdBox();
    await insertOperation(suite, b.nodeId, { role: "destination", state: "filing_assumed" });
    await holdActivationRow(b.nodeId, { sourceNodeId: THIRD_BOX });
    await repair(b.nodeId);
    await expectUnrecorded(b.nodeId);
  });

  it("a row of the other scenario leaves the operation unrecorded", async () => {
    const b = await box(suite);
    await insertOperation(suite, b.nodeId, { role: "destination", state: "filing_assumed" });
    await holdActivationRow(b.nodeId, { scenario: "emergency" });
    await repair(b.nodeId);
    await expectUnrecorded(b.nodeId);
  });

  it("a row agreeing with an operation that names another destination leaves it unrecorded", async () => {
    const b = await box(suite);
    await joinThirdBox();
    await insertOperation(suite, b.nodeId, {
      role: "destination",
      state: "filing_assumed",
      destinationNodeId: THIRD_BOX,
    });
    await holdActivationRow(b.nodeId, { destinationNodeId: THIRD_BOX });
    await repair(b.nodeId);
    await expectUnrecorded(b.nodeId);
  });

  it("a row naming this box under an operation that names another destination leaves it unrecorded", async () => {
    const b = await box(suite);
    await joinThirdBox();
    await insertOperation(suite, b.nodeId, {
      role: "destination",
      state: "filing_assumed",
      destinationNodeId: THIRD_BOX,
    });
    await holdActivationRow(b.nodeId);
    await repair(b.nodeId);
    await expectUnrecorded(b.nodeId);
  });

  it.each(["prepared", "copy_accepted"] as const)(
    "an operation at %s is never repaired, even with a row",
    async (state) => {
      const b = await box(suite);
      await insertOperation(suite, b.nodeId, { role: "destination", state });
      await holdActivationRow(b.nodeId);
      await repair(b.nodeId);
      expect(await stateOf(b.nodeId)).toBe(state);
      expect(await suite.node.select().from(nodeHandoverEvents)).toEqual([]);
    },
  );

  it("a source's operation is left alone, even with a row", async () => {
    const b = await box(suite);
    await insertOperation(suite, b.nodeId, { role: "source", state: "filing_assumed" });
    await holdActivationRow(b.nodeId);
    await repair(b.nodeId);
    expect(await stateOf(b.nodeId)).toBe("filing_assumed");
  });

  it("a mirror is left alone, even with a row", async () => {
    const b = await box(suite);
    await insertOperation(suite, b.nodeId, { role: "destination", state: "filing_assumed" });
    await holdActivationRow(b.nodeId);
    await withNodeTransaction(suite.node, (tx) => setNodeModeTx(tx, b.nodeId, "mirror"));
    await repair(b.nodeId);
    expect(await stateOf(b.nodeId)).toBe("filing_assumed");
    expect(await suite.node.select().from(nodeHandoverEvents)).toEqual([]);
  });

  describe("on a chart another box signed, where only the record leaves the silent source uncounted", () => {
    const onThatChart = async () => {
      const b = await box(suite, { heldSignedByPeer: true, peerStanding: "sell-only" });
      await insertOperation(suite, b.nodeId, { role: "destination", state: "filing_assumed" });
      return b;
    };

    it("with the row, the repair lets the box proceed", async () => {
      const b = await onThatChart();
      await holdActivationRow(b.nodeId);
      await repair(b.nodeId);
      expect((await check(suite, b, peerFetch("silent"))).result).toBe("proceed");
    });

    it.each([
      ["another destination", { destinationNodeId: THIRD_BOX }],
      ["another source", { sourceNodeId: THIRD_BOX }],
    ])("with a row naming %s, the same box waits on that source", async (_name, row) => {
      const b = await onThatChart();
      await joinThirdBox();
      await holdActivationRow(b.nodeId, row);
      await repair(b.nodeId);
      expect((await check(suite, b, peerFetch("silent"))).result).toBe("wait");
    });

    it("control: with no row the same box waits on that source", async () => {
      const b = await onThatChart();
      await repair(b.nodeId);
      expect((await check(suite, b, peerFetch("silent"))).result).toBe("wait");
    });
  });
});

describe("activatedFrom: the sources of operations this box activated as destination", () => {
  const suite = useVenueDb({ migrations });
  const ids = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, "0")}`;
  const src = (n: number) => `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, "0")}`;

  it("holds every destination row that reached activated, closed ones included, and nothing else", async () => {
    const b = await box(suite);
    const closed: [number, "source" | "destination", HandoverState][] = [
      [1, "destination", "return_complete"],
      [2, "destination", "return_abandoned"],
      [3, "destination", "abandoned"],
      [4, "destination", "replaced"],
      [5, "source", "return_complete"],
      [6, "source", "replaced"],
    ];
    for (const [n, role, state] of closed)
      await insertOperation(suite, b.nodeId, {
        operationId: ids(n),
        role,
        state,
        sourceNodeId: role === "source" ? b.nodeId : src(n),
      });
    // Another box's row in the same file is not this box's.
    await insertOperation(suite, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", {
      operationId: ids(7),
      role: "destination",
      state: "return_complete",
      sourceNodeId: src(7),
    });
    expect([...(await readActivatedFrom(suite.node, b.nodeId))].sort()).toEqual([src(1), src(2)]);
  });

  it.each<[HandoverState, "controlled" | "emergency", boolean]>([
    ["activated", "controlled", true],
    ["return_pending", "controlled", true],
    ["activated", "emergency", true],
    ["return_pending", "emergency", true],
    ["prepared", "controlled", false],
    ["copy_accepted", "controlled", false],
    ["filing_assumed", "controlled", false],
    ["emergency_declared", "emergency", false],
  ])("an open %s %s destination row is in it: %s", async (state, scenario, inSet) => {
    const b = await box(suite);
    await insertOperation(suite, b.nodeId, {
      role: "destination",
      scenario,
      state,
      sourceNodeId: src(9),
    });
    expect(await readActivatedFrom(suite.node, b.nodeId)).toEqual(new Set(inSet ? [src(9)] : []));
  });
});

describe("the real start check's inputs", () => {
  const suite = useVenueDb({ migrations });

  it("a box that activated as destination does not count the operation's source, and proceeds with that source silent", async () => {
    const b = await box(suite, { peerStanding: "sell-only", heldSignedByPeer: true });
    await insertOperation(suite, b.nodeId, { role: "destination", state: "return_complete" });
    const fetch = peerFetch("silent");
    expect((await check(suite, b, fetch)).result).toBe("proceed");
    // Asked all the same: a newer chart from it would still stop this box.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("control: the same chart and rows without the activated operation waits", async () => {
    const b = await box(suite, { peerStanding: "sell-only", heldSignedByPeer: true });
    expect((await check(suite, b, peerFetch("silent"))).result).toBe("wait");
  });

  it("a peer listed in the chart with no nodes row is not asked, and the box proceeds", async () => {
    const b = await box(suite, { joined: false, peerUrl: OWN_URL });
    const fetch = peerFetch("silent");
    expect((await check(suite, b, fetch)).result).toBe("proceed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("control: the same chart with a nodes row for the spare and no answer waits", async () => {
    const b = await box(suite, { peerUrl: OWN_URL });
    const fetch = peerFetch("silent");
    expect((await check(suite, b, fetch)).result).toBe("wait");
    // At this box's own address: counted, never asked.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("this box's address is read from the held chart's own entry, so a peer at it is not asked", async () => {
    const b = await box(suite, { peerUrl: OWN_URL });
    const fetch = peerFetch("silent");
    const outcome = await runStartPeerCheck({
      db: suite.db,
      node: suite.node,
      ring: RING,
      nodeId: b.nodeId,
      stateDir: NO_STATE_DIR,
      advertisedOrigin: "https://another-spelling.example",
      log: vi.fn(),
      timeoutMs: 1000,
      fetch,
    });
    expect(outcome.result).toBe("wait");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an open destination operation is not this box's open operation: with no counted peer it proceeds", async () => {
    const b = await box(suite, { joined: false });
    await insertOperation(suite, b.nodeId, { role: "destination", state: "copy_accepted" });
    expect((await check(suite, b, peerFetch("silent"))).result).toBe("proceed");
  });

  it("an open source operation past prepared is: with no counted peer the box waits", async () => {
    const b = await box(suite, { joined: false });
    await insertOperation(suite, b.nodeId, { role: "source", state: "source_stepped_down" });
    expect((await check(suite, b, peerFetch("silent"))).result).toBe("wait");
  });

  it("a wait names the joined boxes whose silence made the box wait", async () => {
    const outcome = await check(suite, await box(suite), peerFetch("silent"));
    expect(outcome).toMatchObject({ result: "wait", waitingOn: [PEER.nodeId] });
  });

  it("a wait with no counted peer names none", async () => {
    const b = await box(suite, { joined: false });
    await insertOperation(suite, b.nodeId, { role: "source", state: "source_stepped_down" });
    expect(await check(suite, b, peerFetch("silent"))).toMatchObject({
      result: "wait",
      waitingOn: [],
    });
  });

  it("a box holding no chart asks nobody and proceeds", async () => {
    const venue = await setupVenue(suite.db);
    const fetch = peerFetch("silent");
    const outcome = await check(suite, { nodeId: venue.cfg.nodeId }, fetch);
    expect(outcome).toEqual({ result: "proceed", successorNodeId: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a peer's newer serving chart is held after the check", async () => {
    const b = await box(suite);
    const newer = b.chart(2, [
      [b.nodeId, "serving-primary", OWN_URL],
      [PEER.nodeId, "serving-secondary", PEER_URL],
    ]);
    const outcome = await check(
      suite,
      b,
      peerFetch(() => ({ heldMembership: newer })),
    );
    expect(outcome.result).toBe("proceed");
    expect(await readNodeMembership(suite.db)).toEqual(newer);
  });

  it("a peer's newer chart is not held when a chart evicting its signer was saved while the box asked", async () => {
    const b = await box(suite);
    const eviction = b.chart(2, [
      [b.nodeId, "serving-primary", OWN_URL],
      [PEER.nodeId, "evicted", PEER_URL],
    ]);
    const body = b.chart(3, [
      [b.nodeId, "serving-primary", OWN_URL],
      [PEER.nodeId, "serving-secondary", PEER_URL],
    ]).body;
    const peerChart = {
      body,
      signerNodeId: PEER.nodeId,
      signature: signDocumentBody(body, PEER.privateKey),
      endorsements: [],
    };
    const answer = peerFetch(() => ({ heldMembership: peerChart }));
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      await writeNodeMembership(suite.db, eviction);
      return answer(url, init);
    });
    expect((await check(suite, b, fetch)).result).toBe("proceed");
    expect(await readNodeMembership(suite.db)).toEqual(eviction);
  });

  it("logs each peer's answer kind by node id, and the result", async () => {
    const b = await box(suite);
    const log = vi.fn();
    await check(
      suite,
      b,
      peerFetch(() => ({ heldMembership: b.held })),
      log,
    );
    expect(log).toHaveBeenCalledWith("info", "handover.start_check", {
      result: "proceed",
      peers: [{ nodeId: PEER.nodeId, answer: "=", counted: true }],
    });
  });
});

describe("whom a superseded box names as its successor", () => {
  const suite = useVenueDb({ migrations });
  const takeover = (nodeId: string): PeerOperationStatus => ({
    operationId: OP,
    role: "destination",
    scenario: "controlled",
    state: "copy_accepted",
    sourceNodeId: nodeId,
    destinationNodeId: PEER.nodeId,
  });

  it("a newer chart that fences this box names its serving primary, and is held", async () => {
    const b = await box(suite);
    const newer = b.chart(2, [
      [b.nodeId, "sell-only", OWN_URL],
      [PEER.nodeId, "serving-primary", PEER_URL],
    ]);
    const outcome = await check(
      suite,
      b,
      peerFetch(() => ({ heldMembership: newer })),
    );
    expect(outcome).toMatchObject({ result: "superseded", successorNodeId: PEER.nodeId });
    expect(await readNodeMembership(suite.db)).toEqual(newer);
  });

  it("a peer's takeover, while the held chart still names this box serving primary, names that peer", async () => {
    const b = await box(suite);
    const outcome = await check(
      suite,
      b,
      peerFetch(() => ({ heldMembership: b.held, openOperation: takeover(b.nodeId) })),
    );
    expect(outcome).toMatchObject({ result: "superseded", successorNodeId: PEER.nodeId });
  });

  it("a newer fencing chart naming no serving primary names nobody (Ruling R7)", async () => {
    const b = await box(suite);
    const newer = b.chart(2, [
      [b.nodeId, "sell-only", OWN_URL],
      [PEER.nodeId, "serving-secondary", PEER_URL],
    ]);
    const outcome = await check(
      suite,
      b,
      peerFetch(() => ({ heldMembership: newer })),
    );
    expect(outcome).toMatchObject({ result: "superseded", successorNodeId: null });
  });

  it("a peer's own chart at the held term that fences this box names its serving primary, and the held chart stays", async () => {
    const b = await box(suite);
    const body = b.chart(1, [
      [b.nodeId, "sell-only", OWN_URL],
      [PEER.nodeId, "serving-primary", PEER_URL],
    ]).body;
    const fork = {
      body,
      signerNodeId: PEER.nodeId,
      signature: signDocumentBody(body, PEER.privateKey),
      endorsements: [],
    };
    const outcome = await check(
      suite,
      b,
      peerFetch(() => ({ heldMembership: fork })),
    );
    expect(outcome).toMatchObject({ result: "superseded", successorNodeId: PEER.nodeId });
    expect(await readNodeMembership(suite.db)).toEqual(b.held);
  });

  it("holding no chart, it names nobody", () => {
    expect(successorAfterCheck(null, "m1", [])).toBeNull();
  });

  it("records the restriction once, and keeps one already recorded", async () => {
    const b = await box(suite);
    await recordSupersededAtStart({ node: suite.node, nodeId: b.nodeId }, PEER.nodeId, 2);
    expect(await readHandoverRestriction(suite.node, b.nodeId)).toMatchObject({
      kind: "superseded",
      successorNodeId: PEER.nodeId,
      operationId: null,
      membershipTerm: 2,
    });
    await recordSupersededAtStart({ node: suite.node, nodeId: b.nodeId }, "someone-else", 3);
    expect(await readHandoverRestriction(suite.node, b.nodeId)).toMatchObject({
      successorNodeId: PEER.nodeId,
      membershipTerm: 2,
    });
  });

  it("keeps a handed-over restriction a stepdown recorded", async () => {
    const b = await box(suite);
    await withNodeTransaction(suite.node, (tx) =>
      recordHandoverRestrictionTx(tx, {
        nodeId: b.nodeId,
        operationId: OP,
        kind: "handed-over",
        successorNodeId: PEER.nodeId,
        membershipTerm: 1,
      }),
    );
    await recordSupersededAtStart({ node: suite.node, nodeId: b.nodeId }, PEER.nodeId, 2);
    expect(await readHandoverRestriction(suite.node, b.nodeId)).toMatchObject({
      kind: "handed-over",
    });
  });
});

describe("the real start check's transport", () => {
  const suite = useVenueDb({ migrations });
  let x: BoxAuthority;
  let y: BoxAuthority;
  const servers: BoxServer[] = [];
  beforeAll(async () => {
    [x, y] = await Promise.all([mintBoxAuthority(), mintBoxAuthority()]);
  });
  const stateDirs: string[] = [];
  afterEach(async () => {
    while (servers.length > 0) await servers.pop()!.close();
    while (stateDirs.length > 0) await rm(stateDirs.pop()!, { recursive: true, force: true });
  });

  /** A state folder whose `tls/ca.crt` is `authority`'s, as on a box holding that venue authority. */
  async function holding(authority: BoxAuthority): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "start-peer-check-state-"));
    stateDirs.push(dir);
    await mkdir(join(dir, "tls"));
    await writeFile(join(dir, "tls", "ca.crt"), authority.caPem);
    return dir;
  }

  /** PEER at `localhost` over HTTPS, serving `x`'s leaf and echoing the box's held chart. */
  async function httpsPeer(held: () => SignedMembershipDocument): Promise<string> {
    const server = await startBoxServer(x, (req) => {
      const nonce = (JSON.parse(req.body) as { body: { nonce: string } }).body.nonce;
      const body: PeerStatusBody = {
        nonce,
        heldMembership: held(),
        restriction: null,
        openOperation: null,
        requestedOperation: null,
      };
      return { status: 200, body: JSON.stringify(signEnvelope("status", body as never, PEER)) };
    });
    servers.push(server);
    return server.url;
  }

  async function linkTo(b: Box, authorityPem: string): Promise<void> {
    await writeMirrorLink(suite.node, b.nodeId, {
      originUrl: "https://relay.example",
      boxHostname: "localhost",
      boxCaPem: authorityPem,
      originNodeId: PEER.nodeId,
    });
  }

  it("a main box verifies its spare's certificate under the venue authority", async () => {
    const held: { chart?: SignedMembershipDocument } = {};
    const url = await httpsPeer(() => held.chart!);
    const b = await box(suite, { peerUrl: url });
    held.chart = b.held;
    const log = vi.fn();
    expect((await check(suite, b, undefined, log, await holding(x))).result).toBe("proceed");
    expect(log).toHaveBeenCalledWith("info", "handover.start_check", {
      result: "proceed",
      peers: [{ nodeId: PEER.nodeId, answer: "=", counted: true }],
    });
    expect(servers[0]!.requests).toHaveLength(1);
  });

  it("a peer whose certificate another authority signed is silent, with the reason certificate", async () => {
    const held: { chart?: SignedMembershipDocument } = {};
    const url = await httpsPeer(() => held.chart!);
    const b = await box(suite, { peerUrl: url });
    held.chart = b.held;
    const log = vi.fn();
    expect((await check(suite, b, undefined, log, await holding(y))).result).toBe("wait");
    expect(log).toHaveBeenCalledWith("info", "handover.start_check", {
      result: "wait",
      peers: [{ nodeId: PEER.nodeId, answer: "S", counted: true, why: "certificate" }],
    });
    expect(servers[0]!.requests).toHaveLength(0);
  });

  it("a spare trusts its main box under the venue authority it holds, not the mirror link's copy", async () => {
    const held: { chart?: SignedMembershipDocument } = {};
    const url = await httpsPeer(() => held.chart!);
    const b = await box(suite, { peerUrl: url });
    held.chart = b.held;
    await linkTo(b, x.caPem);
    const log = vi.fn();
    expect((await check(suite, b, undefined, log, await holding(y))).result).toBe("wait");
    expect(log).toHaveBeenCalledWith("info", "handover.start_check", {
      result: "wait",
      peers: [{ nodeId: PEER.nodeId, answer: "S", counted: true, why: "certificate" }],
    });
    expect(servers[0]!.requests).toHaveLength(0);
  });

  it("a box holding no venue authority asks no box over HTTPS: each is silent, with the reason certificate", async () => {
    const held: { chart?: SignedMembershipDocument } = {};
    const url = await httpsPeer(() => held.chart!);
    const b = await box(suite, { peerUrl: url });
    held.chart = b.held;
    const log = vi.fn();
    expect((await check(suite, b, undefined, log)).result).toBe("wait");
    expect(log).toHaveBeenCalledWith("info", "handover.start_check", {
      result: "wait",
      peers: [{ nodeId: PEER.nodeId, answer: "S", counted: true, why: "certificate" }],
    });
    expect(servers[0]!.requests).toHaveLength(0);
  });

  it("pins the main box's authority a spare holds, and its answer counts", async () => {
    const held: { chart?: SignedMembershipDocument } = {};
    const url = await httpsPeer(() => held.chart!);
    const b = await box(suite, { peerUrl: url });
    held.chart = b.held;
    await linkTo(b, x.caPem);
    expect((await check(suite, b, undefined, vi.fn(), await holding(x))).result).toBe("proceed");
  });

  it("control: a pinned authority the box does not present refuses it, logged as certificate", async () => {
    const held: { chart?: SignedMembershipDocument } = {};
    const url = await httpsPeer(() => held.chart!);
    const b = await box(suite, { peerUrl: url });
    held.chart = b.held;
    await linkTo(b, y.caPem);
    const log = vi.fn();
    expect((await check(suite, b, undefined, log, await holding(y))).result).toBe("wait");
    expect(log).toHaveBeenCalledWith("info", "handover.start_check", {
      result: "wait",
      peers: [{ nodeId: PEER.nodeId, answer: "S", counted: true, why: "certificate" }],
    });
    expect(servers[0]!.requests).toHaveLength(0);
  });
});
