import { nextStandings } from "@waitron/membership";
import { writeNodeMembership, type Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import { mintNextMembershipDocument } from "./membership-mint.js";
import "./errors.js";

/**
 * Seed the venue's initial membership document (design §6 R1) right after `establishNodeIdentity`: a
 * fresh primary signs its own single-node org chart at term 0 with its own key, so a document exists
 * before any promotion needs to bump one. `contactUrl` is `""` — no routing consumer reads it yet, and
 * a single-node venue's tills reach the primary by other means. Runs on the owner connection at setup
 * (the same one that just sealed the key); reads the key back rather than threading it out of
 * establish, keeping the two primitives separate and independently testable.
 */
export async function seedTermZeroMembership(
  deps: { db: Database; ring: KeyRing },
  tenantId: string,
  nodeId: string,
): Promise<void> {
  const document = await mintNextMembershipDocument(deps, {
    tenantId,
    heldDocument: null,
    nodes: nextStandings([], nodeId), // the single-node term-0 chart IS nextStandings of an empty set
    signerNodeId: nodeId,
  });
  await writeNodeMembership(deps.db, document);
}
