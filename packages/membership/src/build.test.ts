import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { buildNextMembershipDocument } from "./build.js";
import { generateNodeKeyPair } from "./crypto.js";
import { MAX_NODES, MAX_REVOKED, verifyMembershipDocument } from "./verify.js";
import type { MembershipNode, SignedMembershipDocument } from "./types.js";

const signer = generateNodeKeyPair();
const nodeId = "11111111-1111-1111-1111-111111111111";
const self: MembershipNode = { nodeId, contactUrl: "", standing: "serving-primary" };

describe("buildNextMembershipDocument", () => {
  it("mints term 0 from a null held document, signed and verifiable", () => {
    const doc = buildNextMembershipDocument({
      heldDocument: null,
      nodes: [self],
      signerNodeId: nodeId,
      signerPrivateKey: signer.privateKey,
    });
    expect(doc.body.term).toBe(0);
    expect(doc.body.nodes).toEqual([self]);
    expect(doc.signerNodeId).toBe(nodeId);
    expect(doc.endorsements).toEqual([]);
    const verified = verifyMembershipDocument(doc, { [nodeId]: signer.publicKey });
    expect(verified.valid).toBe(true);
  });

  it("bumps term by exactly one from the held document", () => {
    const held = { body: { term: 7, nodes: [self] } } as unknown as SignedMembershipDocument;
    const doc = buildNextMembershipDocument({
      heldDocument: held,
      nodes: [self],
      signerNodeId: nodeId,
      signerPrivateKey: signer.privateKey,
    });
    expect(doc.body.term).toBe(8);
  });

  it("starts no lower than the floor it is given, and ignores a floor below the next term", () => {
    const held = { body: { term: 0, nodes: [self] } } as unknown as SignedMembershipDocument;
    const next = (heldDocument: SignedMembershipDocument | null, minTerm: number) =>
      buildNextMembershipDocument({
        heldDocument,
        nodes: [self],
        signerNodeId: nodeId,
        signerPrivateKey: signer.privateKey,
        minTerm,
      }).body.term;
    expect(next(held, 3)).toBe(3);
    expect(next(held, 0)).toBe(1);
    expect(next(null, 2)).toBe(2);
  });

  it("carries a provided endorsements array through verbatim", () => {
    const endorsements = [
      {
        nodeId: "22222222-2222-2222-2222-222222222222",
        publicKey: "endorsed-public-key",
        endorsedBy: "33333333-3333-3333-3333-333333333333",
        signature: "endorsement-sig",
      },
    ];
    const doc = buildNextMembershipDocument({
      heldDocument: null,
      nodes: [self],
      signerNodeId: nodeId,
      signerPrivateKey: signer.privateKey,
      endorsements,
    });
    expect(doc.endorsements).toEqual(endorsements);
  });
});

describe("buildNextMembershipDocument and the revoked list", () => {
  const standby: MembershipNode = {
    nodeId: "standby",
    contactUrl: "https://s",
    standing: "evicted",
  };
  const heldWith = (revoked?: readonly string[]) =>
    buildNextMembershipDocument({
      heldDocument: null,
      nodes: [self],
      signerNodeId: nodeId,
      signerPrivateKey: signer.privateKey,
      ...(revoked === undefined ? {} : { revoked }),
    });
  const next = (held: SignedMembershipDocument, extra: { revoked?: readonly string[] } = {}) =>
    buildNextMembershipDocument({
      heldDocument: held,
      nodes: [self],
      signerNodeId: nodeId,
      signerPrivateKey: signer.privateKey,
      ...extra,
    });
  const trust = { [nodeId]: signer.publicKey };
  const codeOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e instanceof AppError ? { code: e.code, params: e.params } : e;
    }
    return "did not throw";
  };

  it("carries the held chart's revoked list into the next chart, signed and verifiable", () => {
    const doc = next(heldWith(["gone"]));
    expect(doc.body.revoked).toEqual(["gone"]);
    expect(verifyMembershipDocument(doc, trust).valid).toBe(true);
  });

  it("uses the revoked list it is given in place of the held one", () => {
    expect(next(heldWith(["gone"]), { revoked: ["gone", "also-gone"] }).body.revoked).toEqual([
      "gone",
      "also-gone",
    ]);
  });

  it("omits the key altogether when the revoked list is empty, so the body keeps two keys", () => {
    expect(Object.keys(next(heldWith(["gone"]), { revoked: [] }).body).sort()).toEqual([
      "nodes",
      "term",
    ]);
    expect(Object.keys(heldWith().body).sort()).toEqual(["nodes", "term"]);
  });

  it("refuses an id listed both in nodes and in revoked", () => {
    expect(
      codeOf(() =>
        buildNextMembershipDocument({
          heldDocument: heldWith(["standby"]),
          nodes: [self, standby],
          signerNodeId: nodeId,
          signerPrivateKey: signer.privateKey,
        }),
      ),
    ).toEqual({ code: "membership.revoked_node_listed", params: { nodeId: "standby" } });
  });

  it("refuses a revoked list naming one id twice", () => {
    expect(codeOf(() => heldWith(["gone", "gone"]))).toEqual({
      code: "membership.revoked_duplicate",
      params: { nodeId: "gone" },
    });
  });

  it("refuses more than MAX_NODES nodes, and signs exactly MAX_NODES", () => {
    const nodes = (count: number): MembershipNode[] =>
      Array.from({ length: count }, (_, i) =>
        i === 0 ? self : { nodeId: `n${i}`, contactUrl: "", standing: "serving-secondary" },
      );
    const build = (count: number) =>
      buildNextMembershipDocument({
        heldDocument: null,
        nodes: nodes(count),
        signerNodeId: nodeId,
        signerPrivateKey: signer.privateKey,
      });
    expect(codeOf(() => build(MAX_NODES + 1))).toEqual({
      code: "membership.chart_too_large",
      params: { list: "nodes", count: MAX_NODES + 1, limit: MAX_NODES },
    });
    expect(verifyMembershipDocument(build(MAX_NODES), trust).valid).toBe(true);
  });

  it("refuses more than MAX_REVOKED revoked ids, and signs exactly MAX_REVOKED", () => {
    const ids = (count: number) => Array.from({ length: count }, (_, i) => `gone-${i}`);
    expect(codeOf(() => heldWith(ids(MAX_REVOKED + 1)))).toEqual({
      code: "membership.chart_too_large",
      params: { list: "revoked", count: MAX_REVOKED + 1, limit: MAX_REVOKED },
    });
    expect(verifyMembershipDocument(heldWith(ids(MAX_REVOKED)), trust).valid).toBe(true);
  });
});
