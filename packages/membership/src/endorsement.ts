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
 * honoured only for an id the held chart lists in good standing. Left open: a removed anchor can
 * still vouch a key of its own making for such an id, when that id is not an anchor itself; and a
 * held chart older than the removal does not know of it.
 */
export function resolveSignerKey(
  signerNodeId: string,
  endorsements: readonly Endorsement[],
  trustSet: TrustSet,
  held: SignedMembershipDocument | null = null,
): string | null {
  const removed = fencedOutNodeIds(held);
  const inGoodStanding = new Set(
    held?.body.nodes.filter((n) => n.standing !== "evicted").map((n) => n.nodeId),
  );
  const trusted = new Map<string, string>(Object.entries(trustSet));
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of endorsements) {
      if (trusted.has(e.nodeId)) continue;
      if (removed.has(e.nodeId)) continue;
      if (removed.has(e.endorsedBy) && !inGoodStanding.has(e.nodeId)) continue;
      const endorserKey = trusted.get(e.endorsedBy);
      if (endorserKey === undefined) continue;
      if (!verifyBytes(endorsementMessage(e.nodeId, e.publicKey), e.signature, endorserKey))
        continue;
      trusted.set(e.nodeId, e.publicKey);
      changed = true;
    }
  }
  return trusted.get(signerNodeId) ?? null;
}
