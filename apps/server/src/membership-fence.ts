import { isFencedStanding, standingOf, type SignedMembershipDocument } from "@waitron/membership";

/**
 * Whether THIS node is fenced (sell-only/evicted) by the currently-held membership document
 * (design §6). A `null` document — a node that has never adopted one — is not fenced. Pure over an
 * already-read document; the boot path reads `node_membership` (`readNodeMembership`) and passes the
 * blob here.
 */
export function isFenced(held: SignedMembershipDocument | null, nodeId: string): boolean {
  if (held === null) return false;
  return isFencedStanding(standingOf(held, nodeId));
}

/**
 * Whether adopting `document` at runtime should trigger a restart-into-fenced (design §6 step 2):
 * true iff this node was NOT already fenced at boot and the newly-adopted document now fences it. A
 * node already fenced at boot is running fenced, so re-adopting a fencing document changes nothing.
 */
export function shouldFenceRestart(
  bootFenced: boolean,
  document: SignedMembershipDocument,
  nodeId: string,
): boolean {
  return !bootFenced && isFenced(document, nodeId);
}
