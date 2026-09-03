import {
  acceptMembershipDocument,
  type AcceptResult,
  type SignedMembershipDocument,
  type TrustSet,
} from "@waitron/membership";
import { persistNodeMembershipIfNewer, readNodeMembership, type Database } from "@waitron/db";

/**
 * Local adoption of a gossiped membership document (design §5). Wired to the pull worker's
 * `adoptMembership` callback (boot.ts, a later task): every /sync-api/hello handshake hands the
 * peer's advertised document here. Runs the Slice-1 two-part accept fence (authentic via the trust
 * set + strictly newer than the held term) and, only on accept, persists it. Returns the
 * `AcceptResult` so the caller can log an adoption; a rejection is the normal, quiet case (an
 * already-held or untrusted document).
 *
 * The `trustSet` is the inert Slice-4 seam: boot passes `{}` today, so every real gossiped document
 * is `untrusted_signer` and this is a production no-op until setup/adopt populates the trust set. The
 * mechanism is exercised only with an injected fixture trust set in tests.
 *
 * This NEVER throws for an expected rejection (untrusted / not-newer / malformed) — those are
 * results, not errors — so the pull loop's best-effort wrapper only ever logs on a genuine
 * DB/transport fault.
 */
export interface AdoptMembershipDeps {
  db: Database; // the pull worker's app-role pool (member of app_user → INSERT/UPDATE on node_membership)
  trustSet: TrustSet;
}

export async function adoptMembership(
  deps: AdoptMembershipDeps,
  raw: unknown,
): Promise<AcceptResult> {
  // Nothing served (older peer) or a non-object blob: not a candidate document. This is a DB-read
  // optimisation, not a correctness gate — the fence below handles a malformed `raw` identically (it
  // re-runs verifyMembershipDocument and yields the same { accepted:false, failure:"malformed" }), so
  // skipping straight to that verdict here just avoids the `readNodeMembership` round-trip for input
  // the fence would reject anyway.
  if (raw === null || typeof raw !== "object") {
    return { accepted: false, reason: "invalid", failure: "malformed" };
  }
  const held = await readNodeMembership(deps.db);
  const currentTerm = held === null ? null : held.body.term;
  // acceptMembershipDocument re-runs verifyMembershipDocument (structural + signature + trust), so
  // casting the unknown blob is safe — a malformed shape yields { accepted:false, failure:"malformed" }.
  const result = acceptMembershipDocument(
    raw as SignedMembershipDocument,
    currentTerm,
    deps.trustSet,
  );
  if (result.accepted) await persistNodeMembershipIfNewer(deps.db, result.document);
  return result;
}
