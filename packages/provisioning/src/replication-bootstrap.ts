import { quoteIdent, quoteLiteral } from "./identifiers.js";
import { INSTANCE_MIGRATOR_ROLE } from "./instance-state.js";

/** The replication LOGIN role. Distinct from `INSTANCE_ROLES` deliberately: those drive the app
 * provisioner's `create-role` plan, and `waitron_repl` cannot be created there — a `CREATEROLE`
 * non-superuser cannot create a `REPLICATION` role (`permission denied to create role`, prototype
 * finding 7). Created by the SUPERUSER bootstrap below; the app provisioner only verifies it. */
export const REPLICATION_ROLE = "waitron_repl";

/**
 * The two SCHEMA-LOCAL statements of the bootstrap: SELECT on the migrator's tables today, and on
 * the ones it creates later (`ALTER DEFAULT PRIVILEGES` — spec §13.3). Split out from the array
 * below because they are the only half that is PER-DATABASE, and a database can be discarded while
 * the cluster-global half survives: the R3 rejoin wipe (`dropAndCreateDatabase`) drops the database
 * and takes its `pg_default_acl` with it, while `waitron_repl` lives in the shared `pg_authid` and
 * remains. These two are the per-database half of `replicationRepairStatements`, which a caller
 * re-runs on a surviving role to restore any lost prerequisite; the whole bootstrap array cannot
 * re-run there — `CREATE ROLE` would fail on the surviving role.
 *
 * Carries NO credential, so unlike the array below it is safe to log and needs no withholding catch.
 * Idempotent: both statements are absolute grants, not increments.
 */
export function replicationSchemaGrantStatements(): string[] {
  const repl = quoteIdent(REPLICATION_ROLE);
  const migrator = quoteIdent(INSTANCE_MIGRATOR_ROLE);
  return [
    `grant select on all tables in schema public to ${repl}`,
    `alter default privileges for role ${migrator} in schema public grant select on tables to ${repl}`,
  ];
}

/**
 * Everything the bootstrap does EXCEPT `CREATE ROLE` — the migrator's `pg_create_subscription`
 * grant, the schema-local SELECT pair (`replicationSchemaGrantStatements`), and the WAL bound (spec
 * §6). Every statement here is idempotent (an absolute grant, a membership re-grant, and an
 * `ALTER SYSTEM SET`), so it is exactly what re-runs on a SURVIVING role to restore any prerequisite
 * that went missing while `waitron_repl` itself lived on in the shared `pg_authid`: an interrupted
 * first bootstrap, a revoked membership, or the R3 rejoin wipe that discards the database's
 * schema-local grants. The whole-array bootstrap cannot re-run there — its `CREATE ROLE` would fail
 * `42710` on the surviving role — which is why this half is split out.
 *
 * Carries NO credential (the password lives only in `CREATE ROLE`), so it is safe to log and needs
 * no withholding catch. Like the full array it MUST run over a superuser connection to the TARGET
 * database: it mixes cluster-global statements (the membership grant, `ALTER SYSTEM`) with the
 * schema-local pair, which land in whichever database the connection is on.
 */
export function replicationRepairStatements(): string[] {
  const migrator = quoteIdent(INSTANCE_MIGRATOR_ROLE);
  return [
    `grant pg_create_subscription to ${migrator}`,
    ...replicationSchemaGrantStatements(),
    `alter system set max_slot_wal_keep_size = ${quoteLiteral("4GB")}`,
    `select pg_reload_conf()`,
  ];
}

/** The one superuser step native replication needs, as SQL for the box image / operator to run once
 * (the fixture's container-superuser stands in). It creates the replication login, grants the
 * migrator (`INSTANCE_ROLES[0]`, `waitron_migrator`) `pg_create_subscription`, gives `waitron_repl`
 * SELECT on today's tables AND on the migrator's future ones
 * (`replicationSchemaGrantStatements`), and bounds the WAL a dead standby retains (spec §6). It
 * does NOT set `wal_level = logical` or `track_commit_timestamp = on`: both are `PGC_POSTMASTER` (a
 * RESTART), so they live in the box image's `postgresql.conf`; the readiness check verifies all
 * three regardless of who set them.
 *
 * `CREATE ROLE` plus `replicationRepairStatements` — every non-`CREATE-ROLE` statement lives in that
 * repair half so a surviving role can restore them by construction, not a copy that could drift.
 *
 * Statement 0 embeds the replication PASSWORD. The whole array is SECRET: run it over a superuser
 * connection, never log it — as `instance-apply.ts` treats `CREATE ROLE`. That connection MUST be
 * to the TARGET database: the array mixes CLUSTER-GLOBAL statements (`CREATE ROLE`, the
 * `pg_create_subscription` grant, `ALTER SYSTEM`) with the SCHEMA-LOCAL pair above, which land in
 * whichever database the connection happens to be on. `readReplicationReadiness` verifies the
 * per-database default privilege landed, so a bootstrap run against the wrong database on the same
 * cluster is caught rather than going green. */
export function replicationBootstrapStatements(password: string): string[] {
  const repl = quoteIdent(REPLICATION_ROLE);
  return [
    `create role ${repl} login replication password ${quoteLiteral(password)}`,
    ...replicationRepairStatements(),
  ];
}
