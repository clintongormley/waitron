import { canonicalize } from "./canonicalize.js";
import { signBytes, verifyBytes } from "./crypto.js";
import { fencedOutNodeIds } from "./fence.js";
import type { Endorsement, SignedMembershipDocument, TrustSet } from "./types.js";

/**
 * `endorsedBy` is DELIBERATELY outside the signed bytes: it only selects the endorser's key, and
 * the signature must verify against that key, so it is authenticated transitively. Folding it in
 * would change the wire format.
 */
function endorsementMessage(nodeId: string, publicKey: string): string {
  return canonicalize({ nodeId, publicKey });
}

export function endorseKey(
  nodeId: string,
  publicKey: string,
  endorserNodeId: string,
  endorserPrivateKey: string,
): Endorsement {
  return {
    nodeId,
    publicKey,
    endorsedBy: endorserNodeId,
    signature: signBytes(endorsementMessage(nodeId, publicKey), endorserPrivateKey),
  };
}

/**
 * An endorsement extends trust only if its endorser is already trusted AND its signature verifies.
 * Bounded by the number of endorsements, so a cycle cannot loop forever.
 *
 * With the receiver's `held` chart, a node it has removed (`fencedOutNodeIds`) is never endorsed
 * into trust, so unless it is a trust ANCHOR its key neither signs nor vouches. An anchor is
 * trusted without any endorsement and stays so — a promoted primary's key is vouched for by the
 * primary it joined under, which may since have been removed — so a removed anchor's endorsement is
 * honoured only for an id the held chart lists in good standing, and a key admitted on its word may
 * not vouch further. Left open: a removed anchor can vouch a key of its own making for a node in
 * good standing that is not an anchor, and then sign as that node; and a held chart older than the
 * removal does not know of it.
 */
export function resolveSignerKey(
  signerNodeId: string,
  endorsements: readonly Endorsement[],
  trustSet: TrustSet,
  held: SignedMembershipDocument | null = null,
  removed: ReadonlySet<string> = fencedOutNodeIds(held),
): string | null {
  const inGoodStanding = new Set(
    held?.body.nodes.filter((n) => n.standing !== "evicted").map((n) => n.nodeId),
  );
  const admittedByRemoved = new Set<string>();
  const trusted = new Map<string, string>(Object.entries(trustSet));
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of endorsements) {
      if (trusted.has(e.nodeId)) continue;
      if (removed.has(e.nodeId)) continue;
      if (admittedByRemoved.has(e.endorsedBy)) continue;
      const byRemoved = removed.has(e.endorsedBy);
      if (byRemoved && !inGoodStanding.has(e.nodeId)) continue;
      const endorserKey = trusted.get(e.endorsedBy);
      if (endorserKey === undefined) continue;
      if (!verifyBytes(endorsementMessage(e.nodeId, e.publicKey), e.signature, endorserKey))
        continue;
      trusted.set(e.nodeId, e.publicKey);
      if (byRemoved) admittedByRemoved.add(e.nodeId);
      changed = true;
    }
  }
  return trusted.get(signerNodeId) ?? null;
}
