import {
  type AcceptResult,
  type SignedMembershipDocument,
  type TrustSet,
  verifyMembershipDocument,
} from "@waitron/membership";
import { persistNodeMembershipIfNewer, type Database } from "@waitron/db";

/**
 * Local adoption of a gossiped membership document (design §5). Wired to the pull worker's
 * `adoptMembership` callback in boot.ts: every /sync-api/hello handshake hands the peer's advertised
 * document here. Enforces the spec §4 two-part acceptance test — authentic AND strictly newer — but
 * splits the two halves across the fastest authoritative check for each:
 *
 *   1. **Authentic** — `verifyMembershipDocument` (pure: structure + signature + trust chain). Run
 *      FIRST, so an untrusted/malformed document is rejected with no DB work at all. `raw` is `unknown`
 *      (an older peer omits the field, a current peer sends `null`, or the payload is junk); the verify
 *      guard validates the shape, so the cast is safe and a bad shape yields `failure:"malformed"`.
 *   2. **Strictly newer** — delegated to `persistNodeMembershipIfNewer`'s ATOMIC term guard, whose
 *      boolean is the sole authority on whether this document became the held one. We deliberately do
 *      NOT pre-read the term and compare (as `acceptMembershipDocument` does): that read-then-write is a
 *      TOCTOU race — the fast lane could persist a higher term between our read and our write, so an
 *      "accepted by the stale read" document would then no-op at the guard yet still be reported adopted
 *      (and mis-logged `membership.adopted` at a term that is not held). Reporting `accepted` iff the row
 *      actually changed makes the result honest under the two-lane race by construction.
 *
 * Returns the `AcceptResult` so the caller can log a real adoption; a rejection is the normal, quiet
 * case (untrusted, or already-superseded). This NEVER throws for an expected rejection — those are
 * results, not errors — so the pull loop's best-effort wrapper only ever logs on a genuine DB fault.
 *
 * The `trustSet` is LIVE as of Slice 4: boot reads it from `nodes.public_key` via
 * `readMembershipTrustSet` (not `{}`). A provisioned primary carries a populated set (its own key,
 * stamped at setup by `establishNodeIdentity`); an adopted cloud mirror carries the primary's key
 * (inherited through the node row `adoptVenue` replicates). So a genuinely-trusted, strictly-newer
 * gossiped document is now accepted. An EMPTY set corresponds to a bare, un-provisioned node with no
 * stamped key — the untrusted control, still exercised with an injected fixture trust set in tests.
 */
export interface AdoptMembershipDeps {
  db: Database; // the pull worker's app-role pool (member of app_user → INSERT/UPDATE on node_membership)
  trustSet: TrustSet;
}

export async function adoptMembership(
  deps: AdoptMembershipDeps,
  raw: unknown,
): Promise<AcceptResult> {
  const verified = verifyMembershipDocument(raw as SignedMembershipDocument, deps.trustSet);
  if (!verified.valid) return { accepted: false, reason: "invalid", failure: verified.reason };
  const document = raw as SignedMembershipDocument;
  // The atomic term guard decides "strictly newer" (and closes the two-lane race, above): `true` iff
  // this document is now the held one; `false` iff a concurrent adopt already persisted an equal-or-
  // higher term, which IS the `not_newer` outcome.
  const persisted = await persistNodeMembershipIfNewer(deps.db, document);
  return persisted ? { accepted: true, document } : { accepted: false, reason: "not_newer" };
}
