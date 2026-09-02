import { canonicalize } from "./canonicalize.js";
import { signBytes, verifyBytes } from "./crypto.js";
import type { Endorsement, TrustSet } from "./types.js";

/**
 * The exact bytes an endorsement signs: the (nodeId, publicKey) pair it vouches for.
 *
 * `endorsedBy` is DELIBERATELY excluded from the signed bytes — it only names which trusted key
 * vouches, and is authenticated TRANSITIVELY, because the endorsement's signature must verify
 * against the endorser's key (resolveSignerKey looks that key up by endorsedBy). Do not "fix" this
 * by folding endorsedBy into the canonicalized payload; that would change the wire format. (Mirrors
 * the equivalent note on signDocumentBody in verify.ts about signerNodeId.)
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
 * Resolve `signerNodeId` to a trusted public key. Trust flows from the setup-established `trustSet`;
 * an endorsement extends trust only if its endorser is itself already trusted AND its signature
 * verifies. Bounded by the number of endorsements, so a cycle cannot loop forever.
 */
export function resolveSignerKey(
  signerNodeId: string,
  endorsements: readonly Endorsement[],
  trustSet: TrustSet,
): string | null {
  const trusted = new Map<string, string>(Object.entries(trustSet));
  // Repeatedly admit any endorsement whose endorser is trusted and whose signature verifies, until
  // no more can be admitted. At most one pass per endorsement, so it terminates on any input.
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
