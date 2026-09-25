import {
  buildNextMembershipDocument,
  type Endorsement,
  type MembershipNode,
  type SignedMembershipDocument,
} from "@waitron/membership";
import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import { readNodeIdentityKey } from "./node-identity.js";

/**
 * Read THIS node's signing key and build and sign the next membership document with
 * `buildNextMembershipDocument`, to which `endorsements` and `minTerm` pass straight through. It
 * writes nothing: persisting the document is the caller's job, so a signing failure leaves no effect.
 */
export async function mintNextMembershipDocument(
  deps: { db: Database; ring: KeyRing },
  args: {
    heldDocument: SignedMembershipDocument | null;
    nodes: readonly MembershipNode[];
    signerNodeId: string;
    endorsements?: readonly Endorsement[];
    minTerm?: number;
  },
): Promise<SignedMembershipDocument> {
  const signerPrivateKey = await readNodeIdentityKey(deps.db, deps.ring);
  return buildNextMembershipDocument({
    heldDocument: args.heldDocument,
    nodes: args.nodes,
    signerNodeId: args.signerNodeId,
    signerPrivateKey,
    endorsements: args.endorsements,
    minTerm: args.minTerm,
  });
}
