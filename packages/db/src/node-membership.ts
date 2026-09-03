import { sql } from "drizzle-orm";
import type { SignedMembershipDocument } from "@waitron/membership";
import type { Database } from "./client.js";
import { nodeMembership } from "./schema/node-membership.js";

/**
 * The held membership document (design §3/§5), or `null` when the table/row is absent — a node that
 * has never adopted a document (unstamped database) or a pre-migration handle. `null` covers BOTH
 * "the table does not exist yet" and "the table is empty", and callers must not tell them apart:
 * both mean nothing has recorded who is currently in charge.
 *
 * Returns the document WHOLE and unverified — the caller re-runs `verifyMembershipDocument` /
 * `acceptMembershipDocument` (@waitron/membership) against it; this layer is storage, not the fence.
 *
 * Uses `to_regclass` rather than catching an undefined-table error, exactly as `readMirrorConfig`/
 * `readDeploymentMode` do: a failed statement aborts the enclosing transaction in PostgreSQL, so
 * probing by failure would poison a transaction the caller may still need.
 */
export async function readNodeMembership(db: Database): Promise<SignedMembershipDocument | null> {
  const present = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('public.node_membership') is not null as exists`,
  );
  if (present.rows[0]?.exists !== true) return null;

  const rows = await db.execute<{ document: SignedMembershipDocument }>(
    sql`select document from node_membership where id = 1`,
  );
  const row = rows.rows[0];
  if (row === undefined) return null;
  // `document` is a jsonb column, so the driver hands it back already parsed. Structural validity is
  // the caller's verify step, not ours.
  return row.document;
}

/**
 * Owner-role UPSERT of the singleton (`id = 1`). A PLAIN setter — it does NOT run the accept test
 * (owner decision, 2026-09-03): the authentic-and-strictly-newer fence is `acceptMembershipDocument`
 * in @waitron/membership, called by the Slice-3 adoption path before it persists here.
 *
 * `term` is denormalised from `document.body.term` (the backlog #197 reconciliation of the Slice-1
 * `number` term with this bigint column). Deriving it here keeps the column and the in-blob term in
 * step for writes through this accessor; the DB does not enforce it, so a raw SQL write could set
 * them apart.
 * `app_user` now holds INSERT/UPDATE on `node_membership` (Slice 3's runtime-adoption grant), but the
 * runtime adoption write is the term-guarded `persistNodeMembershipIfNewer` below, not this accessor:
 * this stays the dumb plain-upsert setter for the owner/promote paths (owner decision, Slice 2).
 */
export async function writeNodeMembership(
  db: Database,
  document: SignedMembershipDocument,
): Promise<void> {
  const term = document.body.term;
  await db
    .insert(nodeMembership)
    .values({ id: 1, term, document })
    .onConflictDoUpdate({
      target: nodeMembership.id,
      set: { term, document, updatedAt: sql`now()` },
    });
}

/**
 * Term-guarded conditional upsert of the `node_membership` singleton — the atomic monotonic backstop
 * behind the accept fence (both the ordered and fast lanes adopt from the same peer, so read-accept-
 * write can race; the WHERE closes it, including the first-adopt race a row lock cannot). Returns
 * whether the row actually changed. SIBLING to `writeNodeMembership`, which stays the deliberately
 * dumb plain-upsert setter (owner decision, Slice 2); this is the runtime-adoption write, called by
 * apps/server's `adoptMembership` only after the accept fence (@waitron/membership) has already
 * decided the document is authentic and worth persisting.
 *
 * `term` is denormalised from `document.body.term`, the same way `writeNodeMembership` does it.
 * `setWhere` fires the UPDATE half of the upsert only when the existing row's term is strictly lower
 * than the incoming one, so a not-newer document is a no-op rather than an overwrite. `.returning()`
 * reports whether a row was actually inserted or updated — a conflict whose `setWhere` is false
 * updates nothing and returns zero rows, which is how the caller tells "adopted" from "already held".
 * Modelled on the `.onConflictDoUpdate({...}).returning({...})` shape in `allocate-order-number.ts`.
 */
export async function persistNodeMembershipIfNewer(
  db: Database,
  document: SignedMembershipDocument,
): Promise<boolean> {
  const term = document.body.term;
  const rows = await db
    .insert(nodeMembership)
    .values({ id: 1, term, document })
    .onConflictDoUpdate({
      target: nodeMembership.id,
      set: { term, document, updatedAt: sql`now()` },
      setWhere: sql`${nodeMembership.term} < ${term}`,
    })
    .returning({ id: nodeMembership.id });
  return rows.length > 0;
}
