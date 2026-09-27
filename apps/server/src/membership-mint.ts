import {
  buildNextMembershipDocument,
  type MembershipNode,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { readNodeEndorsement, type Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { readNodeIdentityKey } from "./node-identity.js";

export const MAX_CHART_WRITE_ROUNDS = 8;

/**
 * `buildNextMembershipDocument` refuses a chart no receiver would verify. Each is a conflict with
 * the chart this node holds, so a route that mints maps them to 409 rather than its default 400.
 */
export const CHART_MINT_REFUSALS: Record<string, ContentfulStatusCode> = {
  "membership.chart_too_large": 409,
  "membership.cleared_list_full": 409,
  "membership.revoked_duplicate": 409,
  "membership.revoked_node_listed": 409,
};

/**
 * Read THIS node's signing key and build and sign the next membership document. The signer's stored
 * endorsement, if any, is always carried, so a peer that trusts only the endorser's key can accept
 * the document when that endorsement is valid for the signer's key. Persisting the document is the
 * caller's job.
 */
export async function mintNextMembershipDocument(
  deps: { db: Database; ring: KeyRing },
  args: {
    heldDocument: SignedMembershipDocument | null;
    nodes: readonly MembershipNode[];
    signerNodeId: string;
    minTerm?: number;
    revoked?: readonly string[];
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
    revoked: args.revoked,
  });
}
