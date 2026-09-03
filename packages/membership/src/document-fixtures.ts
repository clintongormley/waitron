import { signDocumentBody } from "./verify.js";
import type { MembershipDocumentBody, SignedMembershipDocument } from "./types.js";

// Shared test-support builders for the single-node happy-path document the accept and verify
// suites both exercise. One definition, several imports, rather than copy-pasted literals that can
// silently drift. Not source under test — excluded from coverage in vitest.config.ts.

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
