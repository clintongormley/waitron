import { writeNodeMembership, type Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import { mintNextMembershipDocument } from "./membership-mint.js";
import "./errors.js";

/**
 * Seed the venue's initial membership document right after `establishNodeIdentity`: a fresh primary
 * signs its own single-node document at term 0, so a document exists before any promotion needs to
 * bump one. `contactUrl` is the node's `advertisedOrigin` — the address tills route on.
 */
export async function seedTermZeroMembership(
  deps: { db: Database; ring: KeyRing },
  nodeId: string,
  contactUrl: string,
): Promise<void> {
  const document = await mintNextMembershipDocument(deps, {
    heldDocument: null,
    nodes: [{ nodeId, contactUrl, standing: "serving-primary" }],
    signerNodeId: nodeId,
  });
  await writeNodeMembership(deps.db, document);
}
