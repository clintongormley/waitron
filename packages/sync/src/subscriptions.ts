import { sql } from "drizzle-orm";
import { AppError, quoteLiteral, sqlStateOf } from "@waitron/shared";
import type { Database } from "@waitron/db";
import { quoted } from "./identifier.js";
import "./errors.js";

/** The replication login and the peer to reach it. Secret in whole. */
export interface ReplicationConnection {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

// libpq keyword/value: each value single-quoted, `\` and `'` backslash-escaped INSIDE the libpq
// quotes. The outer SQL-literal escaping is applied separately by `quoteLiteral` at CREATE time.
function libpqValue(value: string): string {
  return `'${value.replace(/([\\'])/g, "\\$1")}'`;
}

/** The libpq conninfo for a subscription's CONNECTION. Carries the password — never log it. */
export function buildConninfo(c: ReplicationConnection): string {
  return [
    `host=${libpqValue(c.host)}`,
    `port=${libpqValue(String(c.port))}`,
    `dbname=${libpqValue(c.database)}`,
    `user=${libpqValue(c.user)}`,
    `password=${libpqValue(c.password)}`,
  ].join(" ");
}

/** `CREATE SUBSCRIPTION` for one peer direction. `origin = none` is the whole echo defence
 * (prototype (a)/finding 3). The standby's is created enabled naming both publications; the
 * primary's is created disabled and re-enabled only for the drain window (spec §2.2) — the caller
 * chooses. The returned string embeds the conninfo literal and is SECRET; do not log it. */
export function createSubscriptionStatement(opts: {
  name: string;
  conninfo: string;
  publications: readonly string[];
  copyData: boolean;
  enabled: boolean;
}): string {
  const pubs = opts.publications.map(quoted).join(", ");
  return (
    `CREATE SUBSCRIPTION ${quoted(opts.name)} CONNECTION ${quoteLiteral(opts.conninfo)} ` +
    `PUBLICATION ${pubs} ` +
    `WITH (copy_data = ${opts.copyData ? "true" : "false"}, origin = none, enabled = ${opts.enabled ? "true" : "false"})`
  );
}

export async function createSubscription(
  db: Database,
  opts: {
    name: string;
    conninfo: string;
    publications: readonly string[];
    copyData: boolean;
    enabled: boolean;
  },
): Promise<void> {
  try {
    await db.execute(sql.raw(createSubscriptionStatement(opts)));
  } catch (error) {
    // Only the SQLSTATE. The statement carries the conninfo password; the raw error (and its
    // `cause`) quotes it back — mirror `instance-apply.ts`'s `create-role` catch.
    throw new AppError("sync.subscription_failed", { sqlState: sqlStateOf(error) });
  }
}

// The maintenance verbs embed NO secret (only the subscription name / publication names / an LSN), so
// each is a pure statement builder (unit-testable string) plus a thin exec.
export function enableSubscriptionStatement(name: string): string {
  return `ALTER SUBSCRIPTION ${quoted(name)} ENABLE`;
}
export function disableSubscriptionStatement(name: string): string {
  return `ALTER SUBSCRIPTION ${quoted(name)} DISABLE`;
}
export function dropSubscriptionStatement(name: string): string {
  return `DROP SUBSCRIPTION IF EXISTS ${quoted(name)}`;
}
export function setSubscriptionPublicationsStatement(
  name: string,
  publications: readonly string[],
): string {
  // WITH (refresh = false): probe C — narrowing to the drain-window publication mid-drain must NOT
  // refresh, or Postgres drops the tables the narrowed set no longer names and loses their un-applied
  // WAL. The caller refreshes explicitly (refreshSubscription) only when it means to.
  return (
    `ALTER SUBSCRIPTION ${quoted(name)} SET PUBLICATION ${publications.map(quoted).join(", ")} ` +
    `WITH (refresh = false)`
  );
}
export function refreshSubscriptionStatement(name: string): string {
  return `ALTER SUBSCRIPTION ${quoted(name)} REFRESH PUBLICATION`;
}
export function skipSubscriptionStatement(name: string, lsn: string): string {
  if (!/^[0-9A-F]+\/[0-9A-F]+$/i.test(lsn)) throw new Error(`not an LSN: ${JSON.stringify(lsn)}`);
  return `ALTER SUBSCRIPTION ${quoted(name)} SKIP (lsn = '${lsn}')`;
}
export async function enableSubscription(db: Database, name: string): Promise<void> {
  await db.execute(sql.raw(enableSubscriptionStatement(name)));
}
export async function disableSubscription(db: Database, name: string): Promise<void> {
  await db.execute(sql.raw(disableSubscriptionStatement(name)));
}
export async function dropSubscription(db: Database, name: string): Promise<void> {
  await db.execute(sql.raw(dropSubscriptionStatement(name)));
}
/** Narrow (or widen) which publications a subscription names — the drain-window
 * `SET PUBLICATION waitron_<env>_ledger` in spec §4.2, built here and called in step 4. */
export async function setSubscriptionPublications(
  db: Database,
  name: string,
  publications: readonly string[],
): Promise<void> {
  await db.execute(sql.raw(setSubscriptionPublicationsStatement(name, publications)));
}
/** The operator SKIP over a refused transaction (spec §6). `lsn` is validated to the LSN shape. */
export async function skipSubscription(db: Database, name: string, lsn: string): Promise<void> {
  await db.execute(sql.raw(skipSubscriptionStatement(name, lsn)));
}
/** Refresh a subscription's table set from its publications — the deliberate counterpart to the
 * `refresh = false` narrowing, called only when the caller means to pick up added/removed tables. */
export async function refreshSubscription(db: Database, name: string): Promise<void> {
  await db.execute(sql.raw(refreshSubscriptionStatement(name)));
}
/** Drop a subscription whose publisher-side slot is ALREADY GONE (the peer was wiped). A plain DROP
 * would try to drop the slot over a dead connection and hang, so the slot reference is cleared first:
 * DISABLE, `SET (slot_name = NONE)`, then DROP. The now-orphaned slot (if the peer still lived) is
 * reclaimed separately by `dropReplicationSlot` / the DROP DATABASE wipe (Ruling I3). */
export async function dropSubscriptionDetached(db: Database, name: string): Promise<void> {
  await db.execute(sql.raw(disableSubscriptionStatement(name)));
  await db.execute(sql.raw(`ALTER SUBSCRIPTION ${quoted(name)} SET (slot_name = NONE)`));
  await db.execute(sql.raw(dropSubscriptionStatement(name)));
}
/** Drop a publisher-side replication slot. `db` MUST be a connection the caller authenticated AS a
 * REPLICATION role (`waitron_repl`): there is NO `SET ROLE` and NO migrator→`waitron_repl` grant
 * (Ruling I3 — the §3 "never widen a grant"). No step-4 caller — this is step-5 orphaned-slot
 * reclamation and the operator SKIP runbook. The slot identifier is validated (a wiring bug is
 * refused loudly), then bound as a parameter to `pg_drop_replication_slot`. */
export async function dropReplicationSlot(db: Database, slot: string): Promise<void> {
  quoted(slot); // validate-and-throw; the value itself travels bound, below.
  await db.execute(sql`select pg_drop_replication_slot(${slot})`);
}
