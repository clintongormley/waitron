import { sql } from "drizzle-orm";
import { AppError, sqlStateOf } from "@waitron/shared";
import type { Database } from "@waitron/db";
import "./errors.js";

// A subscription/publication name. Same validate-and-throw discipline as publications.ts: a name
// outside the set is a wiring bug, refused loudly, never quoted around.
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
function quoted(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`unsafe replication identifier: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

/** A SQL string literal for the CONNECTION conninfo (which carries the password — the result is
 * secret, never logged). Mirrors `packages/provisioning/src/identifiers.ts`'s `quoteLiteral`: when a
 * backslash is present it emits the `E'…'` form with doubled backslashes, because
 * `standard_conforming_strings` is per-session and the plain form would corrupt a backslash-bearing
 * literal. Single quotes are always doubled. */
function sqlLiteral(value: string): string {
  const doubledQuotes = value.replace(/'/g, "''");
  if (value.includes("\\")) return `E'${doubledQuotes.replace(/\\/g, "\\\\")}'`;
  return `'${doubledQuotes}'`;
}

/** The replication login and the peer to reach it. Secret in whole. */
export interface ReplicationConnection {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

// libpq keyword/value: each value single-quoted, `\` and `'` backslash-escaped INSIDE the libpq
// quotes. The outer SQL-literal escaping is applied separately by `sqlLiteral` at CREATE time.
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
    `CREATE SUBSCRIPTION ${quoted(opts.name)} CONNECTION ${sqlLiteral(opts.conninfo)} ` +
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
  return `ALTER SUBSCRIPTION ${quoted(name)} SET PUBLICATION ${publications.map(quoted).join(", ")}`;
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
