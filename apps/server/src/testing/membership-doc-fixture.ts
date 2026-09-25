import {
  generateNodeKeyPair,
  signDocumentBody,
  type MembershipDocumentBody,
  type MembershipNode,
  type NodeKeyPair,
  type SignedMembershipDocument,
} from "@waitron/membership";

/**
 * A signed membership document at `term`, signed by `signerNodeId` (default "A") with a generated —
 * or caller-supplied — node identity key. `nodes` defaults to a single serving-primary entry for the
 * signer. Pass `keyPair` when the caller also builds a `TrustSet` for the same key.
 */
export function signedMembershipDoc(
  term: number,
  opts: { signerNodeId?: string; keyPair?: NodeKeyPair; nodes?: readonly MembershipNode[] } = {},
): SignedMembershipDocument {
  const keyPair = opts.keyPair ?? generateNodeKeyPair();
  const signerNodeId = opts.signerNodeId ?? "A";
  const body: MembershipDocumentBody = {
    term,
    nodes: opts.nodes ?? [
      { nodeId: signerNodeId, contactUrl: "https://a", standing: "serving-primary" },
    ],
  };
  return {
    body,
    signerNodeId,
    signature: signDocumentBody(body, keyPair.privateKey),
    endorsements: [],
  };
}
