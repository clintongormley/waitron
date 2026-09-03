import type { AcceptResult, SignedMembershipDocument, TrustSet } from "./types.js";
import { verifyMembershipDocument } from "./verify.js";

/**
 * The two-part membership fence (design §4): a document is adopted only if it is BOTH authentic
 * (signature + trust chain) AND strictly newer than the one currently held. Note the asymmetry the
 * spec relies on (§5): this can only ever raise the held term (accept a demotion/eviction); it never
 * grants authority. `currentTerm === null` means nothing is held yet.
 */
export function acceptMembershipDocument(
  incoming: SignedMembershipDocument,
  currentTerm: number | null,
  trustSet: TrustSet,
): AcceptResult {
  const verified = verifyMembershipDocument(incoming, trustSet);
  if (!verified.valid) return { accepted: false, reason: "invalid", failure: verified.reason };
  if (currentTerm !== null && verified.term <= currentTerm)
    return { accepted: false, reason: "not_newer" };
  return { accepted: true, document: incoming };
}
