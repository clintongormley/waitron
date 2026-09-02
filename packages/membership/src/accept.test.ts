import { describe, expect, it } from "vitest";
import { generateNodeKeyPair } from "./crypto.js";
import { signDocumentBody } from "./verify.js";
import { acceptMembershipDocument } from "./accept.js";
import type { MembershipDocumentBody, SignedMembershipDocument, TrustSet } from "./types.js";

function doc(term: number, nodeId: string, priv: string): SignedMembershipDocument {
  const body: MembershipDocumentBody = {
    term,
    nodes: [{ nodeId: "A", contactUrl: "https://a", standing: "serving-primary" }],
  };
  return { body, signerNodeId: nodeId, signature: signDocumentBody(body, priv), endorsements: [] };
}

describe("acceptMembershipDocument", () => {
  const a = generateNodeKeyPair();
  const trust: TrustSet = { A: a.publicKey };

  it("accepts a valid, strictly-newer document", () => {
    const r = acceptMembershipDocument(doc(2, "A", a.privateKey), 1, trust);
    expect(r.accepted).toBe(true);
  });
  it("accepts a valid document when none is held yet (null current)", () => {
    expect(acceptMembershipDocument(doc(0, "A", a.privateKey), null, trust).accepted).toBe(true);
  });
  it("rejects an equal term as not_newer", () => {
    expect(acceptMembershipDocument(doc(2, "A", a.privateKey), 2, trust)).toEqual({
      accepted: false,
      reason: "not_newer",
    });
  });
  it("rejects a lower term as not_newer", () => {
    expect(acceptMembershipDocument(doc(1, "A", a.privateKey), 2, trust)).toEqual({
      accepted: false,
      reason: "not_newer",
    });
  });
  it("treats a held term of 0 as held, not as nothing held (=== null, not falsy)", () => {
    expect(acceptMembershipDocument(doc(0, "A", a.privateKey), 0, trust)).toEqual({
      accepted: false,
      reason: "not_newer",
    });
  });
  it("rejects an untrusted document as invalid, carrying the verify failure", () => {
    expect(acceptMembershipDocument(doc(9, "A", a.privateKey), 1, {})).toEqual({
      accepted: false,
      reason: "invalid",
      failure: "untrusted_signer",
    });
  });
});
