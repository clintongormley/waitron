import { sql } from "drizzle-orm";
import { readDeploymentEnvironment, type Database, type DeploymentEnvironment } from "@waitron/db";
import { manifestSets } from "@waitron/migrations";
import { assertIdentifier } from "./identifiers.js";

/**
 * The three LOGIN roles a deployment needs. `waitron_migrator` and `waitron_app` are the names
 * `apps/server/README.md` already uses (e.g. lines 83, 104, 137 — checked directly, not assumed).
 * `waitron_provisioner` does not appear anywhere in that file; it originates in
 * `docs/superpowers/specs/2026-07-29-provisioning-tool-design.md` (§2's "a third role", and §4's
 * idempotency table), which is where this package's own third role first comes from.
 */
export const INSTANCE_ROLES = ["waitron_migrator", "waitron_app", "waitron_provisioner"] as const;
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
  bypassRls: boolean;
  /** Direct memberships only, by role name. `pg_auth_members`, not the recursive closure: the
   * planner grants a specific membership and needs to know whether that exact edge is present. */
  memberOf: string[];
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

  const dbRows = await admin.execute<{ exists: boolean }>(
    sql`select exists (select 1 from pg_database where datname = ${database}) as exists`,
  );
  const databaseExists = dbRows.rows[0]?.exists === true;

  // The two `::text`/`::text[]` casts below are load-bearing, not decoration. `pg_roles.rolname`
  // is Postgres's `name` type, so an uncast `array(select g.rolname ...)` is `name[]` — OID 1003 —
  // and node-postgres's driver has no default parser for that OID: it hands back the wire literal
  // (e.g. `"{app_user_probe}"`, or `"{}"` when empty) as a raw STRING, not an array. Confirmed
  // against a real container: the uncast version of this query returned `member_of: "{}"` typeof
  // "string" for every row, populated or not. OID 1009 (`_text`) IS one of the array types `pg`
  // parses natively, so casting every element — and the `coalesce` fallback — to `text` is what
  // makes `member_of` an actual `string[]` rather than a value that only looks like one until a
  // caller reads it.
  const roleRows = await admin.execute<{
    rolname: string;
    rolcanlogin: boolean;
    rolcreaterole: boolean;
    rolsuper: boolean;
    rolbypassrls: boolean;
    member_of: string[];
  }>(sql`
    select r.rolname, r.rolcanlogin, r.rolcreaterole, r.rolsuper, r.rolbypassrls,
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
      bypassRls: row.rolbypassrls,
      memberOf: row.member_of,
    };
  }

  return {
    database,
    databaseExists,
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
