import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  acceptMembershipDocument,
  generateNodeKeyPair,
  type AcceptResult,
  type SignedMembershipDocument,
  type TrustSet,
} from "@waitron/membership";
import { fetchPeerMembershipDocument, reconcileMembershipOnBoot } from "./membership-reconcile.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";

// Ruling C7. Deleting the pull worker deleted membership gossip; a box that died BEFORE it was fenced
// would boot with a stale serving-primary chart and SELL while the promoted cloud is also primary (two
// nodes filing under one NIF — CLAUDE.md §5, unrecoverable). `reconcileMembershipOnBoot` closes that hole
// at boot: it best-effort fetches the peer's CURRENT signed chart and, when that chart VERIFIES, has a
// HIGHER term, AND fences this node, persists it and reports `superseded: true` so the caller boots
// read-only. Every other outcome — unreachable, equal/lower term, a chart that does not verify — reports
// `superseded: false` and boot proceeds as primary (the "unreachable → proceed" rule: a box that cannot
// reach the cloud cannot have been superseded without a reachable cloud AND a human promotion).
//
// These are pure unit tests over the decoupled function: the peer fetch and the accept-and-persist are
// injected, so the fence LOGIC is exercised here without a container. The accept dep wraps the REAL
// `acceptMembershipDocument` (real signature + trust-chain + strictly-newer check over real signed
// fixtures) with a persist recorder — so "verifies", "higher term" and "equal term" are genuinely
// exercised, not faked; the real DB persist is proven at boot in `boot.reconcile.test.ts`.

const PEER_KEY = generateNodeKeyPair();
const UNTRUSTED_KEY = generateNodeKeyPair();
const PEER_NODE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const THIS_NODE = "33333333-3333-4333-8333-333333333333";
// This node trusts the peer's key (the promoted cloud signs the chart that fences this node); the
// UNTRUSTED_KEY is deliberately absent so a chart signed by it fails verification.
const TRUST: TrustSet = { [PEER_NODE]: PEER_KEY.publicKey };

// This node's own stale chart: it still names ITSELF serving-primary at term N. Only `body.term` is read
// by reconcile (as the accept fence's `currentTerm`), so its own signature need not be trusted here.
const HELD_TERM = 4;
const held: SignedMembershipDocument = signedMembershipDoc(HELD_TERM, {
  signerNodeId: THIS_NODE,
  nodes: [{ nodeId: THIS_NODE, contactUrl: "https://box", standing: "serving-primary" }],
});

/** A chart signed by the peer that lists the peer as serving-primary and this node as `standing`. */
function peerChart(
  term: number,
  standing: "serving-primary" | "serving-secondary" | "sell-only" | "evicted",
  keyPair = PEER_KEY,
): SignedMembershipDocument {
  return signedMembershipDoc(term, {
    signerNodeId: PEER_NODE,
    keyPair,
    nodes: [
      { nodeId: PEER_NODE, contactUrl: "https://cloud", standing: "serving-primary" },
      { nodeId: THIS_NODE, contactUrl: "https://box", standing },
    ],
  });
}

/** The boot wiring's accept dep, over the REAL fence, recording every document it actually persists. */
function acceptRecorder(persisted: SignedMembershipDocument[]) {
  return async (
    incoming: SignedMembershipDocument,
    currentTerm: number | null,
  ): Promise<AcceptResult> => {
    const result = acceptMembershipDocument(incoming, currentTerm, TRUST);
    if (result.accepted) persisted.push(incoming);
    return result;
  };
}

interface LogLine {
  level: string;
  event: string;
}
function capturingLog(lines: LogLine[]) {
  return (level: string, event: string) => {
    lines.push({ level, event });
  };
}

describe("reconcileMembershipOnBoot", () => {
  it("returns superseded and persists a higher-term chart that fences this node", async () => {
    const persisted: SignedMembershipDocument[] = [];
    const lines: LogLine[] = [];
    const fencing = peerChart(HELD_TERM + 1, "sell-only");

    const result = await reconcileMembershipOnBoot({
      held,
      nodeId: THIS_NODE,
      peerUrl: "https://cloud",
      fetchPeerMembership: () => Promise.resolve(fencing),
      acceptDocument: acceptRecorder(persisted),
      log: capturingLog(lines),
    });

    expect(result).toEqual({ superseded: true });
    expect(persisted).toEqual([fencing]);
    expect(lines).toContainEqual({
      level: "warn",
      event: "node.membership_superseded_on_boot",
    });
  });

  it("proceeds as primary when the peer is unreachable (fetch returns null)", async () => {
    const persisted: SignedMembershipDocument[] = [];
    const lines: LogLine[] = [];

    const result = await reconcileMembershipOnBoot({
      held,
      nodeId: THIS_NODE,
      peerUrl: "https://cloud",
      fetchPeerMembership: () => Promise.resolve(null),
      acceptDocument: acceptRecorder(persisted),
      log: capturingLog(lines),
    });

    expect(result).toEqual({ superseded: false });
    expect(persisted).toEqual([]);
    expect(lines).toEqual([]);
  });

  it("proceeds as primary for an equal-term chart (not strictly newer)", async () => {
    const persisted: SignedMembershipDocument[] = [];
    // Same term as held, and it WOULD fence this node — but it is not newer, so the fence never engages.
    const sameTerm = peerChart(HELD_TERM, "sell-only");

    const result = await reconcileMembershipOnBoot({
      held,
      nodeId: THIS_NODE,
      peerUrl: "https://cloud",
      fetchPeerMembership: () => Promise.resolve(sameTerm),
      acceptDocument: acceptRecorder(persisted),
      log: () => {},
    });

    expect(result).toEqual({ superseded: false });
    expect(persisted).toEqual([]);
  });

  it("ignores a higher-term chart that does not verify (untrusted signer)", async () => {
    const persisted: SignedMembershipDocument[] = [];
    // Higher term AND it fences this node, but signed by a key absent from the trust set: verification
    // fails, so the fence must NOT engage — an unsigned/forged chart can never send a node read-only.
    const forged = peerChart(HELD_TERM + 1, "sell-only", UNTRUSTED_KEY);

    const result = await reconcileMembershipOnBoot({
      held,
      nodeId: THIS_NODE,
      peerUrl: "https://cloud",
      fetchPeerMembership: () => Promise.resolve(forged),
      acceptDocument: acceptRecorder(persisted),
      log: () => {},
    });

    expect(result).toEqual({ superseded: false });
    expect(persisted).toEqual([]);
  });

  it("treats a null held document as currentTerm null (a node that never adopted a chart)", async () => {
    // A box that has never held a chart: `currentTerm` is null, so any verified chart is strictly newer.
    // A fencing one from the peer supersedes it just the same.
    const seenTerms: (number | null)[] = [];
    const fencing = peerChart(1, "sell-only");

    const result = await reconcileMembershipOnBoot({
      held: null,
      nodeId: THIS_NODE,
      peerUrl: "https://cloud",
      fetchPeerMembership: () => Promise.resolve(fencing),
      acceptDocument: (incoming, currentTerm) => {
        seenTerms.push(currentTerm);
        return Promise.resolve({ accepted: true, document: incoming });
      },
      log: () => {},
    });

    expect(result).toEqual({ superseded: true });
    expect(seenTerms).toEqual([null]);
  });

  it("persists a higher-term chart that does NOT fence this node but stays primary", async () => {
    // A newer, verified chart that leaves this node serving-secondary is authoritative and worth
    // persisting, but it does not fence this node — so the node keeps selling (not superseded).
    const persisted: SignedMembershipDocument[] = [];
    const lines: LogLine[] = [];
    const nonFencing = peerChart(HELD_TERM + 1, "serving-secondary");

    const result = await reconcileMembershipOnBoot({
      held,
      nodeId: THIS_NODE,
      peerUrl: "https://cloud",
      fetchPeerMembership: () => Promise.resolve(nonFencing),
      acceptDocument: acceptRecorder(persisted),
      log: capturingLog(lines),
    });

    expect(result).toEqual({ superseded: false });
    expect(persisted).toEqual([nonFencing]);
    expect(lines).toEqual([]);
  });
});

describe("fetchPeerMembershipDocument (the best-effort HTTP peer read)", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server !== undefined) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  /** Start a one-off http server with the given handler, returning its base URL. */
  async function serve(
    handler: (respond: (status: number, body: string) => void) => void,
  ): Promise<string> {
    server = createServer((_req, res) => {
      handler((status, body) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(body);
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/management-api/membership`;
  }

  it("returns the peer's document on a 200 { document }", async () => {
    const doc = peerChart(HELD_TERM + 1, "sell-only");
    const url = await serve((respond) => respond(200, JSON.stringify({ document: doc })));
    expect(await fetchPeerMembershipDocument(url)).toEqual(doc);
  });

  it("returns null when the peer holds no chart yet (document: null)", async () => {
    const url = await serve((respond) => respond(200, JSON.stringify({ document: null })));
    expect(await fetchPeerMembershipDocument(url)).toBeNull();
  });

  it("returns null on a non-2xx response (e.g. 401 unauthorized)", async () => {
    const url = await serve((respond) =>
      respond(401, JSON.stringify({ error: { code: "password.invalid" } })),
    );
    expect(await fetchPeerMembershipDocument(url)).toBeNull();
  });

  it("returns null on a body that does not parse as JSON", async () => {
    const url = await serve((respond) => respond(200, "<html>not json</html>"));
    expect(await fetchPeerMembershipDocument(url)).toBeNull();
  });

  it("returns null when the peer is unreachable (transport error)", async () => {
    // Port 1 is not listening — the fetch rejects, which the best-effort read swallows to null.
    expect(
      await fetchPeerMembershipDocument("http://127.0.0.1:1/management-api/membership"),
    ).toBeNull();
  });
});
