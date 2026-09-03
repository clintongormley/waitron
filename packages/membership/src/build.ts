import type {
  Endorsement,
  MembershipDocumentBody,
  MembershipNode,
  SignedMembershipDocument,
} from "./types.js";
import { signDocumentBody } from "./verify.js";

/**
 * Mint the NEXT membership document (design §8): bump `term` by one over the held document (or start at
 * 0 when none is held), take the caller-supplied node list as the new org chart, and sign the whole body
 * with the minting node's own key. Pure — the caller reads the signer key and the held document, and
 * persists the result; this only builds and signs. `endorsements` defaults to none (R1 signs with a
 * directly-trusted key; the endorsement chain is an R2/R3 concern).
 */
export function buildNextMembershipDocument(args: {
  heldDocument: SignedMembershipDocument | null;
  nodes: readonly MembershipNode[];
  signerNodeId: string;
  signerPrivateKey: string;
  endorsements?: readonly Endorsement[];
}): SignedMembershipDocument {
  const body: MembershipDocumentBody = {
    term: (args.heldDocument?.body.term ?? -1) + 1,
    nodes: args.nodes,
  };
  return {
    body,
    signerNodeId: args.signerNodeId,
    signature: signDocumentBody(body, args.signerPrivateKey),
    endorsements: args.endorsements ?? [],
  };
}
