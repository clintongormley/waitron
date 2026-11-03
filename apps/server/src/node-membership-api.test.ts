import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  readNodeMembership,
  withNodeTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, type KeyRing } from "@waitron/credentials";
import {
  generateNodeKeyPair,
  signDocumentBody,
  type MembershipDocumentBody,
  type NodeStanding,
  type SignedMembershipDocument,
} from "@waitron/membership";
import {
  NODE_MIGRATIONS,
  readHandoverRestriction,
  recordHandoverRestrictionTx,
} from "@waitron/node-db";
import type { StepDownRequest, StepDownResult } from "./handover-stepdown.js";
import { mountNodeMembershipApi, type NodeMembershipApiDeps } from "./node-membership-api.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xe).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

function chart(
  term: number,
  signer: { nodeId: string; privateKey: string },
  nodes: readonly [string, NodeStanding][],
): SignedMembershipDocument {
  const body: MembershipDocumentBody = {
    term,
    nodes: nodes.map(([nodeId, standing], i) => ({
      nodeId,
      contactUrl: `https://box-${i}`,
      standing,
    })),
  };
  return {
    body,
    signerNodeId: signer.nodeId,
    signature: signDocumentBody(body, signer.privateKey),
    endorsements: [],
  };
}

describe("POST /api/node/membership", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS, NODE_MIGRATIONS],
  });

  async function boxes(options: { selling?: boolean; fullStart?: boolean } = {}) {
    const db = suite.db;
    await seedVenue(db);
    const self = await seedNode(db);
    const peer = await seedNode(db);
    for (const nodeId of [self, peer])
      await establishNodeIdentity({ ownerDb: db, node: suite.node, ring: RING }, nodeId);
    const peerSigner = {
      nodeId: peer,
      privateKey: await readNodeIdentityKey(suite.node, RING, peer),
    };
    const held = chart(4, peerSigner, [
      [self, "serving-primary"],
      [peer, "serving-secondary"],
    ]);
    await writeNodeMembership(db, held);
    const stepDown = vi.fn<(request: StepDownRequest) => Promise<StepDownResult>>(() =>
      Promise.resolve({ restarting: true, replayed: false }),
    );
    const deps: NodeMembershipApiDeps = { db, node: suite.node, nodeId: self };
    if (options.fullStart !== false) {
      deps.stepDown = stepDown;
      deps.selling = () => options.selling ?? true;
    }
    const app = new Hono();
    mountNodeMembershipApi(app, deps, () => {});
    return { db, self, peer, peerSigner, held, app, stepDown };
  }

  async function hand(app: Hono, body: unknown): Promise<{ status: number; body: unknown }> {
    const response = await app.request("/api/node/membership", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  it("a newer chart that fences a selling box closes its gate, stops its outside work, restricts it and restarts", async () => {
    const { app, self, peer, peerSigner, stepDown, db } = await boxes();
    const fencing = chart(5, peerSigner, [
      [self, "sell-only"],
      [peer, "serving-primary"],
    ]);
    expect(await hand(app, { document: fencing })).toEqual({
      status: 200,
      body: { accepted: true },
    });
    expect(stepDown).toHaveBeenCalledTimes(1);
    expect(stepDown.mock.calls[0]![0]).toMatchObject({
      kind: "superseded",
      successorNodeId: peer,
      membershipTerm: 5,
    });
    expect(stepDown.mock.calls[0]![0].self).toBeDefined();
    expect(await readNodeMembership(db)).toEqual(fencing);
  });

  it("a newer chart that does not fence it is held, and the box keeps selling", async () => {
    const { app, self, peer, peerSigner, stepDown, db } = await boxes();
    const next = chart(5, peerSigner, [
      [self, "serving-primary"],
      [peer, "serving-secondary"],
    ]);
    expect(await hand(app, { document: next })).toEqual({ status: 200, body: { accepted: true } });
    expect(stepDown).not.toHaveBeenCalled();
    expect(await readNodeMembership(db)).toEqual(next);
  });

  it("an older or equal chart changes nothing", async () => {
    const { app, self, peer, peerSigner, stepDown, db, held } = await boxes();
    for (const term of [3, 4]) {
      const stale = chart(term, peerSigner, [
        [self, "sell-only"],
        [peer, "serving-primary"],
      ]);
      expect(await hand(app, { document: stale })).toEqual({
        status: 200,
        body: { accepted: false },
      });
    }
    expect(stepDown).not.toHaveBeenCalled();
    expect(await readNodeMembership(db)).toEqual(held);
  });

  it("a chart signed by an unknown key changes nothing", async () => {
    const { app, self, peer, stepDown, db, held } = await boxes();
    const stranger = { nodeId: peer, privateKey: generateNodeKeyPair().privateKey };
    const forged = chart(9, stranger, [
      [self, "sell-only"],
      [peer, "serving-primary"],
    ]);
    expect(await hand(app, { document: forged })).toEqual({
      status: 200,
      body: { accepted: false },
    });
    expect(stepDown).not.toHaveBeenCalled();
    expect(await readNodeMembership(db)).toEqual(held);
  });

  it("a body that is no chart answers only that it was not accepted", async () => {
    const { app, stepDown, db, held } = await boxes();
    for (const body of [{}, { document: "x" }, "not json", []]) {
      expect(await hand(app, body)).toEqual({ status: 200, body: { accepted: false } });
    }
    expect(stepDown).not.toHaveBeenCalled();
    expect(await readNodeMembership(db)).toEqual(held);
  });

  it("a restricted box stays restricted when handed an older chart", async () => {
    const { app, self, peer, peerSigner, db, held } = await boxes({ fullStart: false });
    const restriction = {
      nodeId: self,
      operationId: null,
      kind: "superseded" as const,
      successorNodeId: peer,
      membershipTerm: 4,
    };
    await withNodeTransaction(suite.node, (tx) => recordHandoverRestrictionTx(tx, restriction));
    const older = chart(3, peerSigner, [
      [self, "serving-primary"],
      [peer, "serving-secondary"],
    ]);
    expect(await hand(app, { document: older })).toEqual({
      status: 200,
      body: { accepted: false },
    });
    expect(await readNodeMembership(db)).toEqual(held);
    expect(await readHandoverRestriction(suite.node, self)).toMatchObject(restriction);
  });

  it("a restricted box holds a newer fencing chart without a second stepdown", async () => {
    const { app, self, peer, peerSigner, stepDown, db } = await boxes();
    const restriction = {
      nodeId: self,
      operationId: null,
      kind: "superseded" as const,
      successorNodeId: peer,
      membershipTerm: 4,
    };
    await withNodeTransaction(suite.node, (tx) => recordHandoverRestrictionTx(tx, restriction));
    const fencing = chart(6, peerSigner, [
      [self, "evicted"],
      [peer, "serving-primary"],
    ]);
    expect(await hand(app, { document: fencing })).toEqual({
      status: 200,
      body: { accepted: true },
    });
    expect(stepDown).not.toHaveBeenCalled();
    expect(await readNodeMembership(db)).toEqual(fencing);
    expect(await readHandoverRestriction(suite.node, self)).toMatchObject(restriction);
  });

  it("a box that is not selling holds a newer fencing chart without stepping down", async () => {
    const { app, self, peer, peerSigner, stepDown, db } = await boxes({ selling: false });
    const fencing = chart(5, peerSigner, [
      [self, "sell-only"],
      [peer, "serving-primary"],
    ]);
    expect(await hand(app, { document: fencing })).toEqual({
      status: 200,
      body: { accepted: true },
    });
    expect(stepDown).not.toHaveBeenCalled();
    expect(await readNodeMembership(db)).toEqual(fencing);
  });

  it("a fencing chart that names no serving main box is held without stepping down", async () => {
    const { app, self, peer, peerSigner, stepDown, db } = await boxes();
    const fencing = chart(5, peerSigner, [
      [self, "sell-only"],
      [peer, "serving-secondary"],
    ]);
    expect(await hand(app, { document: fencing })).toEqual({
      status: 200,
      body: { accepted: true },
    });
    expect(stepDown).not.toHaveBeenCalled();
    expect(await readNodeMembership(db)).toEqual(fencing);
  });
});
