import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { Database } from "@waitron/db";
import { INSTANCE_ROLES } from "./instance-state.js";
import { REPLICATION_ROLE } from "./replication-bootstrap.js";
import "./errors.js";

/** The instance facts native replication needs (swap spec §3, prototype §Setup). `walLevel` and
 * `trackCommitTimestamp` are `PGC_POSTMASTER` (read, never set here — the box image owns them).
 * `maxSlotWalKeepSizeBounded` is `false` at the default `-1` (unlimited), the one that would fill a
 * primary's disk with a dead standby (spec §6). Every field above is CLUSTER-GLOBAL; only
 * `replicationHasDefaultSelect` is per-database — it reads empty when the bootstrap's schema-local
 * statements (`GRANT … IN SCHEMA public`) were applied to the wrong database on the same cluster. */
export interface ReplicationReadiness {
  walLevel: string;
  trackCommitTimestamp: boolean;
  maxSlotWalKeepSizeBounded: boolean;
  replicationRolePresent: boolean;
  migratorCanCreateSubscription: boolean;
  replicationHasDefaultSelect: boolean;
}

/** Pure: the unmet preconditions, as operator-readable labels (no secrets). Separate from the read
 * so every branch is unit-testable. */
export function replicationReadinessGaps(r: ReplicationReadiness): string[] {
  const gaps: string[] = [];
  if (r.walLevel !== "logical") gaps.push("wal_level is not logical");
  if (!r.trackCommitTimestamp) gaps.push("track_commit_timestamp is off");
  if (!r.maxSlotWalKeepSizeBounded) gaps.push("max_slot_wal_keep_size is unbounded");
  if (!r.replicationRolePresent) gaps.push("replication role missing");
  if (!r.migratorCanCreateSubscription) gaps.push("migrator lacks pg_create_subscription");
  if (!r.replicationHasDefaultSelect)
    gaps.push(
      "replication role has no default SELECT grant in this database (bootstrap not applied here?)",
    );
  return gaps;
}

/** Read the six facts. `pg_create_subscription` is a predefined role (PostgreSQL 16+); the default
 * `max_slot_wal_keep_size` reads back exactly `-1` (unlimited), any bound reads back non-`-1`. The
 * `pg_default_acl` check is scoped to the CONNECTED database, unlike the other five facts. */
export async function readReplicationReadiness(db: Database): Promise<ReplicationReadiness> {
  const rows = await db.execute<{
    wal_level: string;
    track: string;
    slot_bounded: boolean;
    repl_present: boolean;
    migrator_can_subscribe: boolean;
    repl_default_select: boolean;
  }>(sql`
    select
      current_setting('wal_level') as wal_level,
      current_setting('track_commit_timestamp') as track,
      current_setting('max_slot_wal_keep_size') <> '-1' as slot_bounded,
      exists (select 1 from pg_roles where rolname = ${REPLICATION_ROLE} and rolcanlogin and rolreplication) as repl_present,
      exists (
        select 1 from pg_auth_members m
        join pg_roles g on g.oid = m.roleid
        join pg_roles r on r.oid = m.member
        where r.rolname = ${INSTANCE_ROLES[0]} and g.rolname = 'pg_create_subscription'
      ) as migrator_can_subscribe,
      exists (
        select 1
        from pg_default_acl da
        join pg_namespace n on n.oid = da.defaclnamespace
        join pg_roles owner on owner.oid = da.defaclrole
        cross join lateral aclexplode(da.defaclacl) ace
        join pg_roles grantee on grantee.oid = ace.grantee
        where owner.rolname = ${INSTANCE_ROLES[0]}
          and n.nspname = 'public'
          and da.defaclobjtype = 'r'
          and grantee.rolname = ${REPLICATION_ROLE}
          and ace.privilege_type = 'SELECT'
      ) as repl_default_select
  `);
  const row = rows.rows[0];
  return {
    walLevel: row?.wal_level ?? "",
    trackCommitTimestamp: row?.track === "on",
    maxSlotWalKeepSizeBounded: row?.slot_bounded === true,
    replicationRolePresent: row?.repl_present === true,
    migratorCanCreateSubscription: row?.migrator_can_subscribe === true,
    replicationHasDefaultSelect: row?.repl_default_select === true,
  };
}

/** Refuse unless the instance is replication-ready. Called by the replication-setup path (the fixture
 * in S2; the real adopt/promote flow in step 4) BEFORE any publication/subscription — the app
 * provisioner never performs the superuser bootstrap, only verifies it. */
export async function assertReplicationReady(db: Database): Promise<void> {
  const gaps = replicationReadinessGaps(await readReplicationReadiness(db));
  if (gaps.length > 0) throw new AppError("provisioning.replication_not_ready", { missing: gaps });
}
