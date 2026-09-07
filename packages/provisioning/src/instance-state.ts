import { sql } from "drizzle-orm";
import { readDeploymentEnvironment, type Database, type DeploymentEnvironment } from "@waitron/db";
import { manifestSets } from "@waitron/migrations";
import { assertIdentifier } from "./identifiers.js";

/** The two LOGIN roles used by the deployment host. */
export const INSTANCE_ROLES = ["waitron_migrator", "waitron_app"] as const;
export type InstanceRole = (typeof INSTANCE_ROLES)[number];

/**
 * What `pg_roles` says about a role that exists.
 *
 * Attributes, not merely the name — spec §4. A `waitron_migrator` created NOLOGIN, or without
 * `CREATEROLE`, is a broken deployment that a name-only existence check reports as provisioned,
 * and the failure then surfaces at the next boot as a migration error with no obvious cause.
 */
export interface RoleFacts {
  canLogin: boolean;
  createRole: boolean;
  superuser: boolean;
  /** Direct memberships only, by role name. `pg_auth_members`, not the recursive closure: the
   * planner grants a specific membership and needs to know whether that exact edge is present. */
  memberOf: string[];
  /** Whether the ADMIN reading this state can `SET ROLE` to this role — `pg_has_role(current_user,
   * <role>, 'SET')`. Read for BOTH roles but CHECKED only for the migrator (instance-plan.ts): the
   * admin migrates and does the post-migrate role work AS the migrator (a session role option), and
   * only the admin that created the migrator with `createrole_self_grant = 'set'` holds that
   * membership. On a database this tool provisioned it reads `false` for `waitron_app` — the migrator
   * created it and nobody SET ROLEs to it — which is fine, because nothing ever SET ROLEs to the app
   * role. */
  adminCanSetRole: boolean;
}

/** What is observable only once the database itself exists. */
export interface InsideState {
  /** Manifest set names whose journal table is present. Not "which migrations ran" — Drizzle creates
   * the journal table at `drizzle-orm@0.45.2/pg-core/dialect.js:54-55` and only then opens the
   * transaction the set's migrations run in (`:60`), so a journal can outlive a rolled-back set.
   *
   * REPORT ONLY. `formatStatus` (status-command.ts) is the sole consumer. `planInstance` read this
   * to decide whether to emit `migrate` and no longer does — that gate is exactly what the sentence
   * above made unsound. */
  migratedSets: string[];
  stamp: DeploymentEnvironment | null;
}

export interface InstanceState {
  database: string;
  databaseExists: boolean;
  /** The role that OWNS the database (`pg_get_userbyid(pg_database.datdba)`), or `null` when the
   * database does not exist. Native logical replication needs `waitron_migrator` to own every table,
   * so `instance` refuses a database owned by anyone else (instance-plan.ts) — ownership is fixed at
   * CREATE and cannot be granted into place. */
  databaseOwner: string | null;
  /** Roles are CLUSTER-global, so these are readable from the admin connection whether or not the
   * database exists. That asymmetry with `inside` is why the two are separate fields. */
  roles: Partial<Record<InstanceRole, RoleFacts>>;
  /** `null` when the database does not exist — distinct from an empty `InsideState`, which means
   * "it exists and nothing has been applied". */
  inside: InsideState | null;
}

/**
 * Everything spec §4's `instance` table checks, in one read.
 *
 * `target` is a connection to the database named by `database`, or `null` when it does not exist
 * yet. The caller owns opening and closing it — this function cannot open one itself, because on
 * the first run there is nothing to connect to and on later runs the connection string is the
 * caller's to compose.
 */
export async function readInstanceState(
  admin: Database,
  database: string,
  target: Database | null,
): Promise<InstanceState> {
  assertIdentifier("database", database);

  // The owner in the same read as existence: a missing row means "no database", so no owner. The
  // planner refuses a database owned by anyone but the migrator, so ownership is read here rather
  // than inferred.
  const dbRows = await admin.execute<{ owner: string }>(
    sql`select pg_get_userbyid(datdba) as owner from pg_database where datname = ${database}`,
  );
  const databaseExists = dbRows.rows[0] !== undefined;
  const databaseOwner = dbRows.rows[0]?.owner ?? null;

  // Cast membership names to text[] so node-postgres decodes an array, not
  // the wire literal for name[]. The planner compares exact membership names.
  // `pg_has_role(current_user, …, 'SET')`: whether the ADMIN reading this state can SET ROLE to the
  // role — the migrator refusal (instance-plan.ts) needs it, and only the admin that created the
  // migrator with `createrole_self_grant = 'set'` holds it.
  const roleRows = await admin.execute<{
    rolname: string;
    rolcanlogin: boolean;
    rolcreaterole: boolean;
    rolsuper: boolean;
    can_set_role: boolean;
    member_of: string[];
  }>(sql`
    select r.rolname, r.rolcanlogin, r.rolcreaterole, r.rolsuper,
           pg_has_role(current_user, r.rolname, 'SET') as can_set_role,
           coalesce(
             array(select g.rolname::text from pg_auth_members m
                   join pg_roles g on g.oid = m.roleid
                   where m.member = r.oid),
             '{}'::text[]
           ) as member_of
    from pg_roles r
    where r.rolname = any(${sql.raw(`array[${INSTANCE_ROLES.map((r) => `'${r}'`).join(", ")}]`)})
  `);

  const roles: Partial<Record<InstanceRole, RoleFacts>> = {};
  for (const row of roleRows.rows) {
    roles[row.rolname as InstanceRole] = {
      canLogin: row.rolcanlogin,
      createRole: row.rolcreaterole,
      superuser: row.rolsuper,
      memberOf: row.member_of,
      adminCanSetRole: row.can_set_role,
    };
  }

  return {
    database,
    databaseExists,
    databaseOwner,
    roles,
    inside: target === null ? null : await readInside(target),
  };
}

async function readInside(target: Database): Promise<InsideState> {
  const migratedSets: string[] = [];
  for (const set of manifestSets()) {
    // `to_regclass` rather than catching an undefined-table error, for the reason
    // `readDeploymentEnvironment` states: a failed statement aborts the enclosing transaction, so
    // probing by failure would poison a connection the caller still needs.
    const rows = await target.execute<{ exists: boolean }>(
      sql`select to_regclass(${`public.${set.table}`}) is not null as exists`,
    );
    if (rows.rows[0]?.exists === true) migratedSets.push(set.name);
  }
  return { migratedSets, stamp: await readDeploymentEnvironment(target) };
}
