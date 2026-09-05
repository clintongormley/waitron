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
 * statements run autocommit in order. A crash between them leaves the db dropped-not-created, which the
 * idempotent re-run of the R3 flow recovers (the CREATE simply succeeds on the next pass).
 */
export async function dropAndCreateDatabase(args: {
  admin: Database;
  database: string;
}): Promise<void> {
  const name = quoteIdent(args.database);
  await args.admin.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await args.admin.execute(sql.raw(`create database ${name}`));
}
