import {
  generateNodeKeyPair,
  signDocumentBody,
  type MembershipDocumentBody,
  type NodeKeyPair,
  type SignedMembershipDocument,
} from "@waitron/membership";

/**
 * A signed membership document at `term`, signed by `signerNodeId` (default "A") with a generated —
 * or caller-supplied — node identity key. Shared equivalent of the tiny local fixture three suites
 * hand-built independently (membership-adopt.test.ts, sync-api.rls.test.ts,
 * membership-gossip.e2e.test.ts): @waitron/membership's own `sampleBody`/`signDoc` fixtures are
 * package-internal (not on the barrel), so this is built from the exported `signDocumentBody` rather
 * than widening that package's surface.
 *
 * Pass `keyPair` when the caller also needs to build a `TrustSet` mapping `signerNodeId` to the same
 * public key (`{ [signerNodeId]: keyPair.publicKey }`) — generate the pair once at module scope, hand
 * it to every `signedMembershipDoc` call, and derive the trust set from it directly.
 */
export function signedMembershipDoc(
  term: number,
  opts: { signerNodeId?: string; keyPair?: NodeKeyPair } = {},
): SignedMembershipDocument {
  const keyPair = opts.keyPair ?? generateNodeKeyPair();
  const signerNodeId = opts.signerNodeId ?? "A";
  const body: MembershipDocumentBody = {
    term,
    nodes: [{ nodeId: signerNodeId, contactUrl: "https://a", standing: "serving-primary" }],
  };
  return {
    body,
    signerNodeId,
    signature: signDocumentBody(body, keyPair.privateKey),
    endorsements: [],
  };
}
