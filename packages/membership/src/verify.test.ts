import { describe, expect, it } from "vitest";
import { generateNodeKeyPair } from "./crypto.js";
import { sampleBody, signDoc } from "./document-fixtures.js";
import { endorseKey } from "./endorsement.js";
import { signDocumentBody, verifyMembershipDocument } from "./verify.js";
import type { SignedMembershipDocument, TrustSet } from "./types.js";

describe("verifyMembershipDocument", () => {
  const endorsement = { nodeId: "X", publicKey: "k", endorsedBy: "A", signature: "s" };

  it("accepts a document signed by a directly-trusted primary", () => {
    const a = generateNodeKeyPair();
    const trust: TrustSet = { A: a.publicKey };
    const r = verifyMembershipDocument(signDoc(sampleBody(1), "A", a.privateKey), trust);
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.term).toBe(1);
  });

  it("rejects an unknown signer as untrusted_signer", () => {
    const a = generateNodeKeyPair();
    const r = verifyMembershipDocument(signDoc(sampleBody(1), "A", a.privateKey), {}); // empty trust
    expect(r).toEqual({ valid: false, reason: "untrusted_signer" });
  });

  it("rejects a tampered body as bad_signature", () => {
    const a = generateNodeKeyPair();
    const trust: TrustSet = { A: a.publicKey };
    const doc = signDoc(sampleBody(1), "A", a.privateKey);
    const tampered = { ...doc, body: sampleBody(2) }; // signature no longer matches the body
    expect(verifyMembershipDocument(tampered, trust)).toEqual({
      valid: false,
      reason: "bad_signature",
    });
  });

  it("accepts a document signed by an endorsed key", () => {
    const a = generateNodeKeyPair();
    const b = generateNodeKeyPair();
    const trust: TrustSet = { A: a.publicKey };
    const doc: SignedMembershipDocument = {
      body: sampleBody(2),
      signerNodeId: "B",
      signature: signDocumentBody(sampleBody(2), b.privateKey),
      endorsements: [endorseKey("B", b.publicKey, "A", a.privateKey)],
    };
    expect(verifyMembershipDocument(doc, trust).valid).toBe(true);
  });

  it("rejects an offered-but-unchaining endorsement as endorsement_invalid", () => {
    // A is not in the trust set, so B's endorsement cannot chain back to an anchor.
    const a = generateNodeKeyPair();
    const b = generateNodeKeyPair();
    const doc: SignedMembershipDocument = {
      body: sampleBody(2),
      signerNodeId: "B",
      signature: signDocumentBody(sampleBody(2), b.privateKey),
      endorsements: [endorseKey("B", b.publicKey, "A", a.privateKey)],
    };
    expect(verifyMembershipDocument(doc, {})).toEqual({
      valid: false,
      reason: "endorsement_invalid",
    });
  });

  it("rejects a malformed structure as malformed", () => {
    expect(verifyMembershipDocument({} as unknown as SignedMembershipDocument, {})).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("rejects an honestly-signed document with a field injected into a node after signing", () => {
    const a = generateNodeKeyPair();
    const trust: TrustSet = { A: a.publicKey };
    const doc = signDoc(sampleBody(1), "A", a.privateKey);
    const injected = {
      ...doc,
      body: { ...doc.body, nodes: [{ ...doc.body.nodes[0], rogue: "unsigned" }] },
    } as unknown as SignedMembershipDocument;
    expect(verifyMembershipDocument(injected, trust)).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("rejects a document carrying more than MAX_ENDORSEMENTS (8) endorsements as malformed", () => {
    const doc = {
      ...signDoc(sampleBody(1), "A", generateNodeKeyPair().privateKey),
      endorsements: Array.from({ length: 9 }, () => endorsement),
    };
    expect(verifyMembershipDocument(doc, {})).toEqual({ valid: false, reason: "malformed" });
  });

  it("passes a document carrying exactly MAX_ENDORSEMENTS (8) endorsements through the length gate", () => {
    const doc = {
      ...signDoc(sampleBody(1), "A", generateNodeKeyPair().privateKey),
      endorsements: Array.from({ length: 8 }, () => endorsement),
    };
    const result = verifyMembershipDocument(doc, {});
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).not.toBe("malformed");
  });

  const bodyWithNodes = (count: number) => ({
    term: 1,
    nodes: Array.from({ length: count }, (_, i) => ({
      nodeId: `N${i}`,
      contactUrl: "https://n",
      standing: "serving-primary" as const,
    })),
  });

  it("rejects a document carrying more than MAX_NODES (8) nodes as malformed", () => {
    const doc = {
      ...signDoc(sampleBody(1), "A", generateNodeKeyPair().privateKey),
      body: bodyWithNodes(9),
    };
    expect(verifyMembershipDocument(doc, {})).toEqual({ valid: false, reason: "malformed" });
  });

  it("passes a document carrying exactly MAX_NODES (8) nodes through the length gate", () => {
    const doc = {
      ...signDoc(sampleBody(1), "A", generateNodeKeyPair().privateKey),
      body: bodyWithNodes(8),
    };
    const result = verifyMembershipDocument(doc, {});
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).not.toBe("malformed");
  });
});

// Each case is well-formed except for one field, so it exercises exactly one guard branch.
describe("verifyMembershipDocument structural validation", () => {
  const validNode = { nodeId: "A", contactUrl: "https://a", standing: "serving-primary" };
  const validBody = { term: 1, nodes: [validNode] };
  const valid = { signerNodeId: "A", signature: "sig", endorsements: [], body: validBody };

  const malformed: ReadonlyArray<readonly [string, unknown]> = [
    // whole-document shape
    ["null document", null],
    ["non-object document", 42],
    ["missing signerNodeId", { ...valid, signerNodeId: 1 }],
    ["missing signature", { ...valid, signature: 1 }],
    ["endorsements not an array", { ...valid, endorsements: "x" }],
    ["body undefined", { signerNodeId: "A", signature: "sig", endorsements: [] }],
    ["body null", { ...valid, body: null }],
    ["body non-object", { ...valid, body: 5 }],
    ["term not a number", { ...valid, body: { ...validBody, term: "1" } }],
    ["term not an integer", { ...valid, body: { ...validBody, term: 1.5 } }],
    ["term negative", { ...valid, body: { ...validBody, term: -1 } }],
    ["nodes not an array", { ...valid, body: { ...validBody, nodes: "x" } }],
    // per-node guard (isNode)
    ["node null", { ...valid, body: { ...validBody, nodes: [null] } }],
    ["node non-object", { ...valid, body: { ...validBody, nodes: [5] } }],
    [
      "node nodeId not a string",
      { ...valid, body: { ...validBody, nodes: [{ ...validNode, nodeId: 1 }] } },
    ],
    [
      "node contactUrl not a string",
      { ...valid, body: { ...validBody, nodes: [{ ...validNode, contactUrl: 1 }] } },
    ],
    [
      "node standing not a string",
      { ...valid, body: { ...validBody, nodes: [{ ...validNode, standing: 1 }] } },
    ],
    [
      "node standing unknown value",
      { ...valid, body: { ...validBody, nodes: [{ ...validNode, standing: "bogus" }] } },
    ],
    // per-endorsement guard (isEndorsement)
    ["endorsement null", { ...valid, endorsements: [null] }],
    ["endorsement non-object", { ...valid, endorsements: [5] }],
    [
      "endorsement nodeId not a string",
      { ...valid, endorsements: [{ publicKey: "k", endorsedBy: "A", signature: "s" }] },
    ],
    [
      "endorsement publicKey not a string",
      { ...valid, endorsements: [{ nodeId: "B", endorsedBy: "A", signature: "s" }] },
    ],
    [
      "endorsement endorsedBy not a string",
      { ...valid, endorsements: [{ nodeId: "B", publicKey: "k", signature: "s" }] },
    ],
    [
      "endorsement signature not a string",
      { ...valid, endorsements: [{ nodeId: "B", publicKey: "k", endorsedBy: "A" }] },
    ],
    // strict shape: an extra key at any level
    [
      "node with an extra field",
      { ...valid, body: { ...validBody, nodes: [{ ...validNode, extra: 1 }] } },
    ],
    [
      "endorsement with an extra field",
      {
        ...valid,
        endorsements: [{ nodeId: "B", publicKey: "k", endorsedBy: "A", signature: "s", extra: 1 }],
      },
    ],
    ["body with an extra field", { ...valid, body: { ...validBody, extra: 1 } }],
    ["document with an extra top-level field", { ...valid, extra: 1 }],
  ];

  it.each(malformed)("rejects %s as malformed", (_label, doc) => {
    expect(verifyMembershipDocument(doc as unknown as SignedMembershipDocument, {})).toEqual({
      valid: false,
      reason: "malformed",
    });
  });
});
