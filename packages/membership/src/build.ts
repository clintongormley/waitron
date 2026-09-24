import type {
  Endorsement,
  MembershipDocumentBody,
  MembershipNode,
  SignedMembershipDocument,
} from "./types.js";
import { signDocumentBody } from "./verify.js";

/** Build and sign the next membership document; persisting it is the caller's job. */
export function buildNextMembershipDocument(args: {
  heldDocument: SignedMembershipDocument | null;
  nodes: readonly MembershipNode[];
  signerNodeId: string;
  signerPrivateKey: string;
  endorsements?: readonly Endorsement[];
}): SignedMembershipDocument {
  const body: MembershipDocumentBody = {
    term: args.heldDocument === null ? 0 : args.heldDocument.body.term + 1,
    nodes: args.nodes,
  };
  return {
    body,
    signerNodeId: args.signerNodeId,
    signature: signDocumentBody(body, args.signerPrivateKey),
    endorsements: args.endorsements ?? [],
  };
}
