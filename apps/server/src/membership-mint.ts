import {
  buildNextMembershipDocument,
  type MembershipNode,
  type SignedMembershipDocument,
} from "@waitron/membership";
import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import { readNodeIdentityKey } from "./node-identity.js";

/**
 * The server-layer mint helper the design named (§6 R1 item 2): read THIS node's signing key and
 * build+sign the next membership document. One helper serves both seeding (`heldDocument: null`) and
 * promotion (the held chart), factoring the read-key + build glue that would otherwise be duplicated in
 * `membership-seed.ts` and `promote.ts`. PERSISTENCE stays with the caller — seed writes a plain upsert,
 * promote writes inside its atomic owner transaction — so this helper never touches the point-of-no-return
 * (§7); it only reads a key and signs in memory, which is exactly the work that must happen BEFORE that
 * transaction so a signing failure aborts with no effect.
 */
export async function mintNextMembershipDocument(
  deps: { db: Database; ring: KeyRing },
  args: {
    tenantId: string;
    heldDocument: SignedMembershipDocument | null;
    nodes: readonly MembershipNode[];
    signerNodeId: string;
  },
): Promise<SignedMembershipDocument> {
  const signerPrivateKey = await readNodeIdentityKey(deps.db, deps.ring, args.tenantId);
  return buildNextMembershipDocument({
    heldDocument: args.heldDocument,
    nodes: args.nodes,
    signerNodeId: args.signerNodeId,
    signerPrivateKey,
  });
}
