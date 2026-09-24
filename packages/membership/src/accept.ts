import type { AcceptResult, SignedMembershipDocument, TrustSet } from "./types.js";
import { verifyMembershipDocument } from "./verify.js";

/**
 * A document is adopted only if it is BOTH authentic (signature and trust chain) AND strictly newer
 * than the one held. The asymmetry — this can only ever raise the held term (accept a demotion or
 * eviction), never grant authority — is what §5 of
 * `docs/superpowers/specs/2026-09-02-membership-and-rejoin-wire-protocol-design.md` relies on.
 * `currentTerm === null` means nothing is held yet.
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
