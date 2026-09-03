import { sql } from "drizzle-orm";
import {
  acceptMembershipDocument,
  type AcceptResult,
  type SignedMembershipDocument,
  type TrustSet,
} from "@waitron/membership";
import { readNodeMembership, type Database } from "@waitron/db";

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
  // Nothing served (older peer) or a non-object blob: not a candidate document. Fold it into the
  // fence's own malformed verdict rather than a separate return shape — the caller only branches on
  // `accepted`.
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
  if (result.accepted) await persistIfNewer(deps.db, result.document);
  return result;
}

/**
 * Term-guarded conditional upsert of the `node_membership` singleton — the atomic monotonic backstop
 * behind the accept fence (both the ordered and fast lanes adopt from the same peer, so read-accept-
 * write can race; the WHERE closes it, including the first-adopt race a row lock cannot). Returns
 * whether the row actually changed. Kept separate from @waitron/db's `writeNodeMembership`, which is
 * a deliberately dumb plain-upsert setter (owner decision, Slice 2); this is the runtime-adoption
 * write.
 *
 * `term` is denormalised from `document.body.term` (the #197 number↔bigint reconciliation), the same
 * way `writeNodeMembership` does it. `document` is jsonb; Drizzle serialises the JS object bound as a
 * `sql` parameter, so it round-trips through `readNodeMembership` unchanged (pinned by the
 * round-trip test).
 *
 * "Did the upsert change a row" is read from `RETURNING id`: an INSERT and a guard-passing UPDATE
 * each emit one row, while a conflict whose WHERE is false updates nothing and returns zero. This is
 * driver-portable — the raw `execute` result exposes `.rows` under both PGlite and node-postgres,
 * whereas `.rowCount` is not populated on the PGlite path.
 */
export async function persistIfNewer(
  db: Database,
  document: SignedMembershipDocument,
): Promise<boolean> {
  const term = document.body.term;
  const res = await db.execute<{ id: number }>(sql`
    insert into node_membership (id, term, document)
    values (1, ${term}, ${document})
    on conflict (id) do update
      set term = excluded.term, document = excluded.document, updated_at = now()
      where node_membership.term < excluded.term
    returning id
  `);
  return res.rows.length > 0;
}
