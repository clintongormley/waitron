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
 * `app_user` holds no INSERT/UPDATE on `node_membership` (the grant read-back asserts it), so this
 * runs on the provisioning/owner connection, never the app pool — until Slice 3 adds runtime
 * adoption and, with it, the write grant.
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
