import { canonicalize } from "./canonicalize.js";
import { signBytes, verifyBytes } from "./crypto.js";
import type { Endorsement, TrustSet } from "./types.js";

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
 */
export function resolveSignerKey(
  signerNodeId: string,
  endorsements: readonly Endorsement[],
  trustSet: TrustSet,
): string | null {
  const trusted = new Map<string, string>(Object.entries(trustSet));
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of endorsements) {
      if (trusted.has(e.nodeId)) continue;
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
