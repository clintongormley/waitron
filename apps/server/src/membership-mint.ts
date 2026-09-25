import {
  buildNextMembershipDocument,
  type MembershipNode,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { readNodeEndorsement, type Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import { readNodeIdentityKey } from "./node-identity.js";

/**
 * Read THIS node's signing key and build and sign the next membership document. The signer's stored
 * endorsement, if any, is always carried, so a peer that trusts only the endorser's key can accept
 * the document when that endorsement is valid for the signer's key. It writes nothing: persisting
 * the document is the caller's job, so a signing failure leaves no effect.
 */
export async function mintNextMembershipDocument(
  deps: { db: Database; ring: KeyRing },
  args: {
    heldDocument: SignedMembershipDocument | null;
    nodes: readonly MembershipNode[];
    signerNodeId: string;
    minTerm?: number;
  },
): Promise<SignedMembershipDocument> {
  const signerPrivateKey = await readNodeIdentityKey(deps.db, deps.ring);
  const endorsement = await readNodeEndorsement(deps.db, args.signerNodeId);
  return buildNextMembershipDocument({
    heldDocument: args.heldDocument,
    nodes: args.nodes,
    signerNodeId: args.signerNodeId,
    signerPrivateKey,
    endorsements: endorsement === null ? [] : [endorsement],
    minTerm: args.minTerm,
  });
}
