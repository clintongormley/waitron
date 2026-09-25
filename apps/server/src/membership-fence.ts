import { isFencedStanding, standingOf, type SignedMembershipDocument } from "@waitron/membership";

/**
 * Whether THIS node is fenced (sell-only/evicted) by the held membership document. `null` — a node
 * that has never adopted one — is not fenced.
 */
export function isFenced(held: SignedMembershipDocument | null, nodeId: string): boolean {
  if (held === null) return false;
  return isFencedStanding(standingOf(held, nodeId));
}

/**
 * A node already fenced at boot is running fenced, so only a newly-fencing document calls for a
 * restart.
 */
export function shouldFenceRestart(
  bootFenced: boolean,
  document: SignedMembershipDocument,
  nodeId: string,
): boolean {
  return !bootFenced && isFenced(document, nodeId);
}
