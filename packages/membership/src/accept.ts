import type { AcceptResult, SignedMembershipDocument, TrustSet } from "./types.js";
import { verifyMembershipDocument } from "./verify.js";

/**
 * A document is adopted only if it is BOTH authentic (signature and trust chain) AND strictly newer
 * than the one held. The asymmetry — this can only ever raise the held term (accept a demotion or
 * eviction), never grant authority — is deliberate: a signature proves who wrote a document, not
 * that it is current, so one from a peer that missed a promotion may only take authority away.
 * `currentTerm === null` means nothing is held yet. `held` is the receiver's own held chart, for
 * `verifyMembershipDocument`.
 */
export function acceptMembershipDocument(
  incoming: SignedMembershipDocument,
  currentTerm: number | null,
  trustSet: TrustSet,
  held: SignedMembershipDocument | null = null,
): AcceptResult {
  const verified = verifyMembershipDocument(incoming, trustSet, held);
  if (!verified.valid) return { accepted: false, reason: "invalid", failure: verified.reason };
  if (currentTerm !== null && verified.term <= currentTerm)
    return { accepted: false, reason: "not_newer" };
  return { accepted: true, document: incoming };
}
