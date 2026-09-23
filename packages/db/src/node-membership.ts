import { eq, sql } from "drizzle-orm";
import type { SignedMembershipDocument } from "@waitron/membership";
import type { Database, Transaction } from "./client.js";
import { now } from "./schema/columns.js";
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
 * The table's existence is read off `sqlite_master` rather than discovered by running the select and
 * catching the refusal, exactly as `readMirrorConfig`/`readDeploymentMode` do — the reason for that
 * shape, and for the catalogue rather than a pragma, is on `deploymentTableExists` in
 * `./deployment.js`.
 *
 * Accepts a `Database` OR a `Transaction` (the explicit union `client.ts` blesses for a reader that
 * must work on whatever handle it is given): R3b's promote reads the held term through its OWN owner
 * transaction for the supersede diagnostic, so the read must be able to run on that `tx`.
 */
export async function readNodeMembership(
  db: Database | Transaction,
): Promise<SignedMembershipDocument | null> {
  const present = await db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name = ${"node_membership"}`,
  );
  if (present.rows.length === 0) return null;

  // Through the table object, not raw SQL: `document` is stored as JSON TEXT, and it is the column's
  // own read mapping (`json` in ./schema/columns.js) that parses it. A raw select returns the text
  // unchanged, so the caller would be handed a string where the signature says a document.
  // Structural validity is still the caller's verify step, not ours.
  const [row] = await db
    .select({ document: nodeMembership.document })
    .from(nodeMembership)
    .where(eq(nodeMembership.id, 1));
  return row?.document ?? null;
}

/**
 * UPSERT of the singleton (`id = 1`). A PLAIN setter — it does NOT run the accept test
 * (owner decision, 2026-09-03): the authentic-and-strictly-newer fence is `acceptMembershipDocument`
 * in @waitron/membership, called by the Slice-3 adoption path before it persists here.
 *
 * `term` is denormalised from `document.body.term` (the backlog #197 reconciliation of the Slice-1
 * `number` term with this bigint column). Deriving it here keeps the column and the in-blob term in
 * step for writes through this accessor; the DB does not enforce it, so a raw SQL write could set
 * them apart.
 * **Which caller may use this one is a convention, and nothing in the database holds it.** The two
 * setters were told apart by the connection they ran on — PostgreSQL granted `app_user` INSERT and
 * UPDATE here, and this plain one ran on the owner connection instead. There are no roles and no
 * grants on this engine (`./testing/roles.ts`). The split stands on its own terms: a caller that
 * cannot assume it is the only writer goes through the term-guarded `persistNodeMembershipIfNewer`
 * below — gossip adoption (`membership-adopt.ts`), retirement (`retire.ts`) and the adopt
 * handshake's org-chart append (`mirror-bundle-api.ts`) — and this one is for where no concurrent
 * writer exists: seeding (`membership-seed.ts`) and the promote transaction (`promote.ts`, via
 * `writeNodeMembershipTx`) — owner decision, Slice 2.
 */
export async function writeNodeMembership(
  db: Database,
  document: SignedMembershipDocument,
): Promise<void> {
  await db.withWriteLock(async () => writeNodeMembershipTx(db, document));
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
      set: { term, document, updatedAt: now() },
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
  return db.withWriteLock(async () => persistNodeMembershipIfNewerTx(db, document));
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
      set: { term, document, updatedAt: now() },
      setWhere: sql`${nodeMembership.term} < ${term}`,
    })
    .returning({ id: nodeMembership.id });
  return rows.length > 0;
}
