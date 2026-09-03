import { describe, expect, it } from "vitest";
import { buildNextMembershipDocument } from "./build.js";
import { generateNodeKeyPair } from "./crypto.js";
import { verifyMembershipDocument } from "./verify.js";
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
