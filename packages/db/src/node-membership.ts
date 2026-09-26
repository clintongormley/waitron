import { eq, sql } from "drizzle-orm";
import type { SignedMembershipDocument } from "@waitron/membership";
import type { Database, Transaction } from "./client.js";
import { now } from "./schema/columns.js";
import { nodeMembership } from "./schema/node-membership.js";

/**
 * The held membership document, or `null` when the table or the row is absent. Callers must not
 * tell those two apart: both mean nothing has recorded who is currently in charge.
 *
 * Not verified here. A peer's document is stored only after `acceptMembershipDocument`
 * (@waitron/membership) passes it; every other write is one this node minted and signed itself
 * (`mintNextMembershipDocument`), so readers trust the row as boot trusts its deployment axes.
 * A row that arrived any other way is not checked: a restore (archive or bucket) puts back the
 * copy's row as it was, and the start that finishes the restore (`completeRebuild`) signs the next
 * term over that row's node list without verifying it, unless boot's reconcile with a peer replaced
 * the row first; a raw SQL write or a database file edited outside the program is read as is.
 *
 * The table's existence is read off `sqlite_master` rather than discovered by running the select and
 * catching the refusal; the reason is on `deploymentTableExists` in `./deployment.js`.
 */
export async function readNodeMembership(
  db: Database | Transaction,
): Promise<SignedMembershipDocument | null> {
  const present = await db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name = ${"node_membership"}`,
  );
  if (present.rows.length === 0) return null;

  // Through the table object, not raw SQL: `document` is stored as JSON TEXT, and it is the column's
  // own read mapping (`json` in ./schema/columns.js) that parses it.
  const [row] = await db
    .select({ document: nodeMembership.document })
    .from(nodeMembership)
    .where(eq(nodeMembership.id, 1));
  return row?.document ?? null;
}

/**
 * UPSERT of the singleton (`id = 1`). A PLAIN setter — it does NOT run the accept test: the
 * authentic-and-strictly-newer fence is `acceptMembershipDocument` in @waitron/membership.
 *
 * `term` is denormalised from `document.body.term`. Deriving it here keeps the column and the
 * in-blob term in step for writes through this accessor; the DB does not enforce it, so a raw SQL
 * write could set them apart.
 *
 * **Which caller may use this one is a convention, and nothing in the database holds it.** A caller
 * that cannot assume it is the only writer goes through the term-guarded
 * `persistNodeMembershipIfNewer` below, and this one is for where no concurrent writer exists.
 */
export async function writeNodeMembership(
  db: Database,
  document: SignedMembershipDocument,
): Promise<void> {
  await db.withWriteLock(async () => writeNodeMembershipTx(db, document));
}

/**
 * `writeNodeMembership` on a caller-provided transaction, so a caller can commit this write in the
 * SAME transaction as a related change.
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
 * behind the accept fence: read-accept-write can race, and the WHERE closes it. Returns whether the
 * row actually changed: a conflict whose `setWhere` is false updates nothing and returns zero rows,
 * which is how the caller tells "adopted" from "already held".
 */
export async function persistNodeMembershipIfNewer(
  db: Database,
  document: SignedMembershipDocument,
): Promise<boolean> {
  return db.withWriteLock(async () => persistNodeMembershipIfNewerTx(db, document));
}

/** `persistNodeMembershipIfNewer` on a caller-provided transaction. A `false` means a term at
 * least as new is already held, and the caller decides whether to abort the transaction. */
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
