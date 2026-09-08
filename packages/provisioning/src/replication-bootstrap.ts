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
 * remains. A caller that re-provisions such a database must re-issue exactly these two, and cannot
 * re-run the whole array — `CREATE ROLE` would fail on the surviving role.
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

/** The one superuser step native replication needs, as SQL for the box image / operator to run once
 * (the fixture's container-superuser stands in). It creates the replication login, grants the
 * migrator (`INSTANCE_ROLES[0]`, `waitron_migrator`) `pg_create_subscription`, gives `waitron_repl`
 * SELECT on today's tables AND on the migrator's future ones
 * (`replicationSchemaGrantStatements`), and bounds the WAL a dead standby retains (spec §6). It
 * does NOT set `wal_level = logical` or `track_commit_timestamp = on`: both are `PGC_POSTMASTER` (a
 * RESTART), so they live in the box image's `postgresql.conf`; the readiness check verifies all
 * three regardless of who set them.
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
  const migrator = quoteIdent(INSTANCE_MIGRATOR_ROLE);
  return [
    `create role ${repl} login replication password ${quoteLiteral(password)}`,
    `grant pg_create_subscription to ${migrator}`,
    ...replicationSchemaGrantStatements(),
    `alter system set max_slot_wal_keep_size = ${quoteLiteral("4GB")}`,
    `select pg_reload_conf()`,
  ];
}
