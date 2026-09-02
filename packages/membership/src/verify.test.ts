import { describe, expect, it } from "vitest";
import { generateNodeKeyPair } from "./crypto.js";
import { sampleBody, signDoc } from "./document-fixtures.js";
import { endorseKey } from "./endorsement.js";
import { signDocumentBody, verifyMembershipDocument } from "./verify.js";
import type { SignedMembershipDocument, TrustSet } from "./types.js";

describe("verifyMembershipDocument", () => {
  // Shared across the two MAX_ENDORSEMENTS boundary cases: the length gate fires on array size
  // regardless of content, so a single trivially-shaped entry serves both.
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
    // B signs; its key is offered via an endorsement by A, but A is not in the trust set, so the
    // endorsement cannot chain back to an anchor. Because the document DID offer endorsements, this
    // is endorsement_invalid, not untrusted_signer (design §4's two distinct failure modes).
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

  it("rejects a document carrying more than MAX_ENDORSEMENTS (8) endorsements as malformed", () => {
    // The length cap fires on the array size regardless of endorsement content, so trivially-shaped
    // but structurally-valid entries suffice. 9 (MAX_ENDORSEMENTS + 1) must be rejected before any
    // signature or trust is consulted; 8 stays structurally acceptable.
    const doc = {
      ...signDoc(sampleBody(1), "A", generateNodeKeyPair().privateKey),
      endorsements: Array.from({ length: 9 }, () => endorsement),
    };
    expect(verifyMembershipDocument(doc, {})).toEqual({ valid: false, reason: "malformed" });
  });

  it("passes a document carrying exactly MAX_ENDORSEMENTS (8) endorsements through the length gate", () => {
    // The other half of the boundary: 8 must clear the cap so a `>` → `>=` off-by-one would be
    // caught. These trivially-shaped endorsements don't chain to a trusted signer, so verification
    // still fails — but for a NON-length reason, never "malformed" on account of the count.
    const doc = {
      ...signDoc(sampleBody(1), "A", generateNodeKeyPair().privateKey),
      endorsements: Array.from({ length: 8 }, () => endorsement),
    };
    const result = verifyMembershipDocument(doc, {});
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).not.toBe("malformed");
  });
});

// The structural guards reject adversarial input as data (never throw). Each case below is a
// document that is well-formed except for one field, so it exercises exactly one guard branch and
// must be classified `malformed` before trust or signature are ever consulted (design §4).
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
  ];

  it.each(malformed)("rejects %s as malformed", (_label, doc) => {
    expect(verifyMembershipDocument(doc as unknown as SignedMembershipDocument, {})).toEqual({
      valid: false,
      reason: "malformed",
    });
  });
});
