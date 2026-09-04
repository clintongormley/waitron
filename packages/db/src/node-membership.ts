import { sql } from "drizzle-orm";
import type { SignedMembershipDocument } from "@waitron/membership";
import type { Database, Transaction } from "./client.js";
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
 *
 * Accepts a `Database` OR a `Transaction` (the explicit union `client.ts` blesses for a reader that
 * must work on whatever handle it is given): R3b's promote reads the held term through its OWN owner
 * transaction for the supersede diagnostic, so the read must be able to run on that `tx`.
 */
export async function readNodeMembership(
  db: Database | Transaction,
): Promise<SignedMembershipDocument | null> {
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
  await db.transaction((tx) => writeNodeMembershipTx(tx, document));
}

/**
 * The plain-upsert of the singleton on a caller-provided transaction (see `writeNodeMembership` for
 * the full contract — dumb setter, no accept fence, `term` denormalised from `document.body.term`).
 * Exists so a caller can commit this write in the SAME transaction as a related change (CLAUDE.md §3:
 * a caller that must write atomically with another write shares one transaction) — the promotion path
 * (spec `2026-09-03-reserved-standby-identity-and-promotion-design.md` §6 R1) flips the singleton role
 * and writes the new membership document together, so both land or neither does. `writeNodeMembership`
 * is this on its own transaction.
 */
export async function writeNodeMembershipTx(
  tx: Transaction,
  document: SignedMembershipDocument,
): Promise<void> {
  const term = document.body.term;
  await tx
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
  return db.transaction((tx) => persistNodeMembershipIfNewerTx(tx, document));
}

/** The term-guarded singleton upsert on a caller-provided transaction — the atomic monotonic backstop
 * (accept iff strictly newer) that a caller can commit in the SAME transaction as a related write
 * (CLAUDE.md §3). Returns `true` iff a row actually changed; a `false` means a concurrent ≥ term is
 * already held, and the caller decides whether to abort the transaction. R3b's mirror→primary promote
 * commits it with the `deployment` flip so the org chart cannot regress under a gossip-adopt race
 * (spec §8 "R3 sharp edge"); `persistNodeMembershipIfNewer` is this on its own transaction. */
export async function persistNodeMembershipIfNewerTx(
  tx: Transaction,
  document: SignedMembershipDocument,
): Promise<boolean> {
  const term = document.body.term;
  const rows = await tx
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
