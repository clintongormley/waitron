import { quoteIdent, quoteLiteral } from "./identifiers.js";
import { INSTANCE_ROLES } from "./instance-state.js";

/** The replication LOGIN role. Distinct from `INSTANCE_ROLES` deliberately: those drive the app
 * provisioner's `create-role` plan, and `waitron_repl` cannot be created there — a `CREATEROLE`
 * non-superuser cannot create a `REPLICATION` role (`permission denied to create role`, prototype
 * finding 7). Created by the SUPERUSER bootstrap below; the app provisioner only verifies it. */
export const REPLICATION_ROLE = "waitron_repl";

/** The one superuser step native replication needs, as SQL for the box image / operator to run once
 * (the fixture's container-superuser stands in). It creates the replication login, grants the
 * migrator (`INSTANCE_ROLES[0]`, `waitron_migrator`) `pg_create_subscription`, gives `waitron_repl`
 * SELECT on today's tables AND on the migrator's future ones (`ALTER DEFAULT PRIVILEGES` — spec
 * §13.3), and bounds the WAL a dead standby retains (spec §6). It does NOT set `wal_level = logical`
 * or `track_commit_timestamp = on`: both are `PGC_POSTMASTER` (a RESTART), so they live in the box
 * image's `postgresql.conf`; the readiness check verifies all three regardless of who set them.
 *
 * Statement 0 embeds the replication PASSWORD. The whole array is SECRET: run it over a superuser
 * connection, never log it — as `instance-apply.ts` treats `CREATE ROLE`. That connection MUST be
 * to the TARGET database: the array mixes CLUSTER-GLOBAL statements (`CREATE ROLE`, the
 * `pg_create_subscription` grant, `ALTER SYSTEM`) with SCHEMA-LOCAL ones (`GRANT … ON ALL TABLES IN
 * SCHEMA public`, `ALTER DEFAULT PRIVILEGES … IN SCHEMA public`), which land in whichever database
 * the connection happens to be on. `readReplicationReadiness` verifies the per-database default
 * privilege landed, so a bootstrap run against the wrong database on the same cluster is caught
 * rather than going green. */
export function replicationBootstrapStatements(password: string): string[] {
  const repl = quoteIdent(REPLICATION_ROLE);
  const migrator = quoteIdent(INSTANCE_ROLES[0]);
  return [
    `create role ${repl} login replication password ${quoteLiteral(password)}`,
    `grant pg_create_subscription to ${migrator}`,
    `grant select on all tables in schema public to ${repl}`,
    `alter default privileges for role ${migrator} in schema public grant select on tables to ${repl}`,
    `alter system set max_slot_wal_keep_size = ${quoteLiteral("4GB")}`,
    `select pg_reload_conf()`,
  ];
}
