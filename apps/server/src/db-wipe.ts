import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";
import { quoteIdent } from "@waitron/provisioning";

/**
 * Discard a database and recreate it empty — the wipe half of R3 rejoin (spec §4.4), the primitive
 * BR-3 left as a carry-forward (its restore targets a FRESH db and does not create one). `admin` must
 * be connected to a DIFFERENT (maintenance) database — Postgres refuses to drop the database a session
 * is connected to. `WITH (FORCE)` terminates any lingering backend on the target (a stopped-but-
 * -reconnecting server, a leftover pool) so the drop cannot hang on an open connection.
 *
 * Utility statements take no placeholders (CLAUDE.md §3), so the name reaches each statement as text,
 * escaped by `quoteIdent` — the same defence `instance-apply.ts` uses for `create database`.
 * NOT a transaction (CREATE/DROP DATABASE cannot run in one — `instance-apply.ts:52`); the two
 * statements run autocommit in order. A crash between them leaves the target dropped-not-created and the
 * box wiped-but-not-restored; this does NOT self-recover on re-run, because the R3 guards read
 * `node_membership` from the same database this wipes, so a re-run fails at connect or at
 * `rejoin.not_fenced` against the emptied db. No data is lost (the drained tail is on the carrier, the
 * artifact is unchanged), but an operator must complete the restore into the emptied database by hand.
 * An automatic resume-at-restore (detect an emptied/wiped target and skip to restore) is a possible
 * follow-up, deferred because telling a wiped-mid-restore box from a never-provisioned one needs a
 * persisted marker (owner's call at sign-off).
 */
export async function dropAndCreateDatabase(args: {
  admin: Database;
  database: string;
}): Promise<void> {
  const name = quoteIdent(args.database);
  await args.admin.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await args.admin.execute(sql.raw(`create database ${name}`));
}
