import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";
import { quoteIdent } from "@waitron/provisioning";

/**
 * Discard a database and recreate it empty, migrator-owned — the wipe half of R3 rejoin (spec §4.4).
 * TWO handles, because the drop and the create need DIFFERENT privileges (probes A/F):
 *
 *  - `dropAs` — a connection whose effective role OWNS the target database (the migrator, reached via
 *    `withRole(maintenanceUrl, "waitron_migrator")`). Probe F: `DROP DATABASE … WITH (FORCE)` as the
 *    owner also reclaims the target's INACTIVE replication slot with the database — so rejoin needs no
 *    slot drop of its own (Ruling I3). The migrator can drop the db it owns but has NO CREATEDB.
 *  - `createAs` — the plain maintenance admin holding CREATEDB (`waitron_migrator` lacks it, probe A),
 *    which runs `CREATE DATABASE … OWNER <owner>` so the recreated db is owned by the migrator again.
 *
 * Both handles MUST be connected to a DIFFERENT (maintenance) database — Postgres refuses to drop the
 * database a session is connected to. `WITH (FORCE)` terminates any lingering backend on the target so
 * the drop cannot hang. Utility statements take no placeholders (CLAUDE.md §3), so the name and owner
 * reach each statement as text, escaped by `quoteIdent`. NOT a transaction (CREATE/DROP DATABASE cannot
 * run in one); the two statements run autocommit in order. A crash between them leaves the target
 * dropped-not-created and the box wiped; it does not self-recover on re-run (the rejoin guards read
 * `node_membership` from the wiped db), but no data is lost — the drained tail is on the carrier — and
 * an operator re-runs the rejoin, whose next boot is setup mode.
 */
export async function dropAndCreateDatabase(args: {
  dropAs: Database;
  createAs: Database;
  database: string;
  owner: string;
}): Promise<void> {
  const name = quoteIdent(args.database);
  const owner = quoteIdent(args.owner);
  await args.dropAs.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await args.createAs.execute(sql.raw(`create database ${name} owner ${owner}`));
}
