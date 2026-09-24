import { signDocumentBody } from "./verify.js";
import type { MembershipDocumentBody, SignedMembershipDocument } from "./types.js";

/** The single-node body both suites sign at a given term. */
export function sampleBody(term: number): MembershipDocumentBody {
  return { term, nodes: [{ nodeId: "A", contactUrl: "https://a", standing: "serving-primary" }] };
}

/** Assemble a signed, endorsement-free document from a body and the signer's key. */
export function signDoc(
  body: MembershipDocumentBody,
  signerNodeId: string,
  privateKey: string,
): SignedMembershipDocument {
  return { body, signerNodeId, signature: signDocumentBody(body, privateKey), endorsements: [] };
}
