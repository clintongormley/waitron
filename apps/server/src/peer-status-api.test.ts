import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  withNodeTransaction,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { loadKeyRing, nodeSigningPublicKey, type KeyRing } from "@waitron/credentials";
import { signEnvelope, verifyEnvelope, type SignedHandoverEnvelope } from "@waitron/handover";
import {
  endorseKey,
  generateNodeKeyPair,
  signDocumentBody,
  type Endorsement,
  type MembershipDocumentBody,
  type NodeStanding,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { NODE_MIGRATIONS, recordHandoverRestrictionTx } from "@waitron/node-db";
import { askPeerStatus } from "./boot-peer-check.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { mountPeerStatusApi, type PeerStatusBody } from "./peer-status-api.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xd).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_OP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NONCE = "n".repeat(24);

function chart(
  signerNodeId: string,
  privateKey: string,
  nodes: readonly [string, NodeStanding][],
  endorsements: Endorsement[],
): SignedMembershipDocument {
  const body: MembershipDocumentBody = {
    term: 4,
    nodes: nodes.map(([nodeId, standing], i) => ({
      nodeId,
      contactUrl: `https://box-${i}`,
      standing,
    })),
  };
  return { body, signerNodeId, signature: signDocumentBody(body, privateKey), endorsements };
}

describe("POST /api/node/peer-status", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS],
  });

  interface Boxes {
    db: Database;
    self: string;
    peer: string;
    selfKey: string;
    peerKey: string;
    held: SignedMembershipDocument;
    app: Hono;
  }

  async function boxes(
    peerStanding: NodeStanding = "serving-secondary",
    joining?: boolean,
    follow?: import("@waitron/stream").FollowProgress,
  ): Promise<Boxes> {
    const db = suite.db;
    await seedVenue(db, {
      name: "Main room",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta",
    });
    const self = await seedNode(db);
    const peer = await seedNode(db);
    for (const nodeId of [self, peer])
      await establishNodeIdentity({ ownerDb: db, node: suite.node, ring: RING }, nodeId);
    const selfKey = await readNodeIdentityKey(suite.node, RING, self);
    const peerKey = await readNodeIdentityKey(suite.node, RING, peer);
    const held = chart(
      self,
      selfKey,
      [
        [self, "serving-primary"],
        [peer, peerStanding],
      ],
      [endorseKey(peer, nodeSigningPublicKey(peerKey), self, selfKey)],
    );
    await writeNodeMembership(db, held);
    const app = new Hono();
    mountPeerStatusApi(
      app,
      {
        db,
        node: suite.node,
        ring: RING,
        nodeId: self,
        ...(joining === undefined ? {} : { joining }),
        ...(follow === undefined ? {} : { readFollow: () => follow }),
      },
      () => {},
    );
    return { db, self, peer, selfKey, peerKey, held, app };
  }

  function ask(app: Hono, envelope: unknown): Promise<Response> {
    return Promise.resolve(
      app.request("/api/node/peer-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
      }),
    );
  }

  function query(
    signer: { nodeId: string; privateKey: string },
    body: Record<string, string | number> = { nonce: NONCE, atMs: 1_700_000_000_000 },
  ): SignedHandoverEnvelope<Record<string, string | number>> {
    return signEnvelope("query", body, signer);
  }

  it("a box the chart lists gets a signed status echoing its nonce", async () => {
    const { app, self, peer, peerKey, selfKey, held } = await boxes();
    const response = await ask(app, query({ nodeId: peer, privateKey: peerKey }));
    expect(response.status).toBe(200);
    const answer = (await response.json()) as SignedHandoverEnvelope<PeerStatusBody>;
    expect(answer.purpose).toBe("waitron.handover.status.v1");
    expect(answer.signerNodeId).toBe(self);
    const selfPublic = nodeSigningPublicKey(selfKey);
    const verified = verifyEnvelope<PeerStatusBody>(answer, "status", (id) =>
      id === self ? selfPublic : undefined,
    );
    expect(verified).toEqual({
      valid: true,
      signerNodeId: self,
      body: {
        heldMembership: held,
        restriction: null,
        openOperation: null,
        requestedOperation: null,
        nonce: NONCE,
      },
    });
  });

  it("signs native follower facts without opening a private mirror read", async () => {
    const follow = {
      generation: "gen-4-main-20261114T120000Z",
      state: "following" as const,
      appliedTXID: "0000000000000001",
      uploadedTXID: "0000000000000002",
      lagMs: 1200,
      lastAppliedAt: "2026-11-14T12:01:00.000Z",
    };
    const { app, self, peer, peerKey, selfKey } = await boxes(
      "serving-secondary",
      undefined,
      follow,
    );
    const response = await ask(app, query({ nodeId: peer, privateKey: peerKey }));
    const answer = (await response.json()) as SignedHandoverEnvelope<PeerStatusBody>;
    expect(
      verifyEnvelope<PeerStatusBody>(answer, "status", (id) =>
        id === self ? nodeSigningPublicKey(selfKey) : undefined,
      ),
    ).toMatchObject({ valid: true, body: { follow } });
    expect(
      verifyEnvelope(
        { ...answer, body: { ...answer.body, follow: { ...follow, lagMs: 0 } } },
        "status",
        (id) => (id === self ? nodeSigningPublicKey(selfKey) : undefined),
      ),
    ).toMatchObject({ valid: false });
  });

  it("the latch start's answer says it is joining, inside the signature", async () => {
    const { app, self, peer, peerKey, selfKey } = await boxes("serving-secondary", true);
    const response = await ask(app, query({ nodeId: peer, privateKey: peerKey }));
    expect(response.status).toBe(200);
    const answer = (await response.json()) as SignedHandoverEnvelope<PeerStatusBody>;
    const selfPublic = nodeSigningPublicKey(selfKey);
    const keyOf = (id: string) => (id === self ? selfPublic : undefined);
    const verified = verifyEnvelope<PeerStatusBody>(answer, "status", keyOf);
    expect(verified).toMatchObject({ valid: true, body: { joining: true, nonce: NONCE } });
    const withoutJoining: Partial<PeerStatusBody> = { ...answer.body };
    delete withoutJoining.joining;
    expect(verifyEnvelope({ ...answer, body: withoutJoining }, "status", keyOf)).toEqual({
      valid: false,
      reason: "bad_signature",
    });
  });

  it.each([undefined, false])(
    "control: a full start's answer carries no joining field (joining %s)",
    async (joining) => {
      const { app, peer, peerKey } = await boxes("serving-secondary", joining);
      const response = await ask(app, query({ nodeId: peer, privateKey: peerKey }));
      const answer = (await response.json()) as SignedHandoverEnvelope<PeerStatusBody>;
      expect(Object.keys(answer.body)).not.toContain("joining");
    },
  );

  it("answers the restriction and the open operation this box holds", async () => {
    const { app, self, peer, peerKey } = await boxes();
    const deps = { node: suite.node, nodeId: self };
    await beginHandover(
      deps,
      {
        operationId: OP,
        scenario: "controlled",
        venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
        sourceNodeId: self,
        destinationNodeId: peer,
        membership: { term: 4, digest: "a".repeat(64) },
      },
      "source",
    );
    await withNodeTransaction(suite.node, (tx) =>
      recordHandoverRestrictionTx(tx, {
        nodeId: self,
        operationId: OP,
        kind: "handed-over",
        successorNodeId: peer,
        membershipTerm: 4,
      }),
    );
    const response = await ask(
      app,
      query(
        { nodeId: peer, privateKey: peerKey },
        { nonce: NONCE, atMs: 1, operationId: OP, purpose: "status" },
      ),
    );
    expect(response.status).toBe(200);
    const { body } = (await response.json()) as SignedHandoverEnvelope<PeerStatusBody>;
    const operation = {
      operationId: OP,
      role: "source",
      scenario: "controlled",
      state: "prepared",
      sourceNodeId: self,
      destinationNodeId: peer,
    };
    expect(body.restriction).toEqual({
      kind: "handed-over",
      successorNodeId: peer,
      operationId: OP,
    });
    expect(body.openOperation).toEqual(operation);
    expect(body.requestedOperation).toEqual(operation);
  });

  it("a query naming a closed operation gets its closed state in requestedOperation", async () => {
    const { app, self, peer, peerKey } = await boxes();
    const deps = { node: suite.node, nodeId: self };
    await beginHandover(
      deps,
      {
        operationId: OP,
        scenario: "controlled",
        venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
        sourceNodeId: self,
        destinationNodeId: peer,
        membership: { term: 4, digest: "a".repeat(64) },
      },
      "source",
    );
    await advanceHandover(deps, OP, "abandoned", {});
    const named = await ask(
      app,
      query(
        { nodeId: peer, privateKey: peerKey },
        { nonce: NONCE, atMs: 1, operationId: OP, purpose: "status" },
      ),
    );
    const { body } = (await named.json()) as SignedHandoverEnvelope<PeerStatusBody>;
    expect(body.openOperation).toBeNull();
    expect(body.requestedOperation).toEqual({
      operationId: OP,
      role: "source",
      scenario: "controlled",
      state: "abandoned",
      sourceNodeId: self,
      destinationNodeId: peer,
    });

    const unknown = await ask(
      app,
      query(
        { nodeId: peer, privateKey: peerKey },
        { nonce: NONCE, atMs: 1, operationId: OTHER_OP, purpose: "status" },
      ),
    );
    expect(
      ((await unknown.json()) as SignedHandoverEnvelope<PeerStatusBody>).body.requestedOperation,
    ).toBeNull();
  });

  it("a stranger's key is refused 403 handover.peer_unknown", async () => {
    const { app, peer } = await boxes();
    const stranger = generateNodeKeyPair();
    for (const signer of [
      { nodeId: "stranger", privateKey: stranger.privateKey },
      // A listed box's id with a key the chart does not vouch for.
      { nodeId: peer, privateKey: stranger.privateKey },
    ]) {
      const response = await ask(app, query(signer));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: { code: "handover.peer_unknown", params: {} },
      });
    }
  });

  it("an evicted box is refused", async () => {
    const { app, peer, peerKey } = await boxes("evicted");
    const response = await ask(app, query({ nodeId: peer, privateKey: peerKey }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "handover.peer_unknown", params: {} },
    });
  });

  it("the answer verifies with this box's key and fails with any other", async () => {
    const { app, self, peer, peerKey } = await boxes();
    const response = await ask(app, query({ nodeId: peer, privateKey: peerKey }));
    const answer = (await response.json()) as SignedHandoverEnvelope<PeerStatusBody>;
    const otherPublic = generateNodeKeyPair().publicKey;
    expect(verifyEnvelope(answer, "status", () => otherPublic)).toEqual({
      valid: false,
      reason: "bad_signature",
    });
    expect(
      verifyEnvelope(answer, "status", (id) =>
        id === self ? nodeSigningPublicKey(peerKey) : undefined,
      ),
    ).toEqual({ valid: false, reason: "bad_signature" });
  });

  it("refuses a malformed query 400 handover.request_invalid, naming the field", async () => {
    const { app, peer, peerKey } = await boxes();
    const signer = { nodeId: peer, privateKey: peerKey };
    const cases: [unknown, string][] = [
      ["not an envelope", "envelope"],
      [signEnvelope("status", { nonce: NONCE, atMs: 1 }, signer), "envelope"],
      [query(signer, { nonce: "short", atMs: 1 }), "nonce"],
      [query(signer, { nonce: "x".repeat(65), atMs: 1 }), "nonce"],
      [query(signer, { atMs: 1 }), "nonce"],
      [query(signer, { nonce: NONCE }), "atMs"],
      [query(signer, { nonce: NONCE, atMs: "1" }), "atMs"],
      [query(signer, { nonce: NONCE, atMs: 1, operationId: 7 }), "operationId"],
      [query(signer, { nonce: NONCE, atMs: 1, operationId: "" }), "operationId"],
      [query(signer, { nonce: NONCE, atMs: 1, extra: "x" }), "body"],
    ];
    for (const [envelope, field] of cases) {
      const response = await ask(app, envelope);
      expect({ field, status: response.status, body: await response.json() }).toEqual({
        field,
        status: 400,
        body: { error: { code: "handover.request_invalid", params: { field } } },
      });
    }
    const edges = [
      query(signer, { nonce: "x".repeat(16), atMs: 1 }),
      query(signer, { nonce: "x".repeat(64), atMs: 1 }),
    ];
    for (const envelope of edges) expect((await ask(app, envelope)).status).toBe(200);
  });

  it("a query naming an operation is refused unless its purpose is status, naming the field", async () => {
    const { app, peer, peerKey } = await boxes();
    const signer = { nodeId: peer, privateKey: peerKey };
    const refused: Record<string, string | number>[] = [
      { nonce: NONCE, atMs: 1, operationId: OP },
      { nonce: NONCE, atMs: 1, operationId: OP, purpose: "indicator" },
      { nonce: NONCE, atMs: 1, operationId: OP, purpose: "final-copy" },
      { nonce: NONCE, atMs: 1, operationId: OP, purpose: "anything-else" },
      { nonce: NONCE, atMs: 1, operationId: OP, purpose: 7 },
      { nonce: NONCE, atMs: 1, purpose: "status" },
    ];
    for (const body of refused) {
      const response = await ask(app, query(signer, body));
      expect({ body, status: response.status, answer: await response.json() }).toEqual({
        body,
        status: 400,
        answer: { error: { code: "handover.request_invalid", params: { field: "purpose" } } },
      });
    }
  });

  it("the status read a box signs with a query option gets the operation it names", async () => {
    const { app, self, selfKey, peer, peerKey } = await boxes();
    const deps = { node: suite.node, nodeId: self };
    await beginHandover(
      deps,
      {
        operationId: OP,
        scenario: "controlled",
        venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
        sourceNodeId: self,
        destinationNodeId: peer,
        membership: { term: 4, digest: "a".repeat(64) },
      },
      "source",
    );
    await advanceHandover(deps, OP, "abandoned", {});
    const selfPublic = nodeSigningPublicKey(selfKey);
    const status = await askPeerStatus({
      sign: async (body) => signEnvelope("query", body, { nodeId: peer, privateKey: peerKey }),
      publicKeyOf: (nodeId) => (nodeId === self ? selfPublic : undefined),
      fetch: async (url, init) => app.request(String(url), init),
      query: { operationId: OP, purpose: "status" },
    })({ nodeId: self, url: "https://box-0", standing: "serving-primary" });
    expect(status?.requestedOperation).toMatchObject({ operationId: OP, state: "abandoned" });
  });

  it("refuses a query whose signature does not match its body", async () => {
    const { app, peer, peerKey } = await boxes();
    const signed = query({ nodeId: peer, privateKey: peerKey });
    const tampered = { ...signed, body: { ...signed.body, nonce: "m".repeat(24) } };
    const response = await ask(app, tampered);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "handover.peer_unknown", params: {} },
    });
  });
});
