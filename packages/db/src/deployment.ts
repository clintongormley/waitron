import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { Database, Transaction } from "./client.js";
import { deployment } from "./schema/deployment.js";
import "./errors.js";

/**
 * Which environment a database can be stamped for. A package-local union, deliberately NOT
 * `apps/server`'s identically-shaped `DeploymentEnvironment` type — this package must never import
 * from `apps/server` — but a union all the same, not a bare `string`: narrowing this at compile
 * time is what makes an unrepresentable value (e.g. `"staging"`, a stray `process.env.NODE_ENV`) a
 * `tsc` error instead of a runtime `deployment_environment_ck` violation (SQLSTATE 23514) discovered
 * only once `stampDeployment` has already run. Same defect class `packages/fiscal-verifactu`'s
 * `Entorno` (./registro-row.ts) closes one layer down.
 */
export type DeploymentEnvironment = "production" | "preproduction";

/**
 * The environment this database was stamped for, or `null` if it has none.
 *
 * `null` covers BOTH "the table does not exist yet" and "the table is empty", and callers must not
 * try to tell them apart: on a first-ever boot the migration that creates the table has not run,
 * and on a database predating this feature the table exists but is empty. Both mean the same
 * thing — nothing recorded what this database is for — and both are handled identically.
 *
 * Uses `to_regclass` rather than catching an undefined-table error, because in PostgreSQL a failed
 * statement aborts the enclosing transaction: probing by failure would poison a transaction the
 * caller may still need.
 *
 * The return type is narrowed to `DeploymentEnvironment | null`, not a bare `string`, because
 * `0010_deployment_stamp.sql`'s `deployment_environment_ck` is the thing that makes this honest: no
 * row can exist in this column outside `'production'`/`'preproduction'`, so a value read back here
 * is one of those two by construction, never a value merely assumed to be safe.
 */
export async function readDeploymentEnvironment(
  db: Database,
): Promise<DeploymentEnvironment | null> {
  const present = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('public.deployment') is not null as exists`,
  );
  if (present.rows[0]?.exists !== true) return null;

  const rows = await db.execute<{ environment: DeploymentEnvironment }>(
    sql`select environment from deployment where id = 1`,
  );
  return rows.rows[0]?.environment ?? null;
}

/**
 * Records which environment this database belongs to. Idempotent for the same value; a DIFFERENT
 * value is refused rather than overwritten, because the rows already written under the first one
 * cannot be moved (the design's §2). This immutability is the ENVIRONMENT's alone: the same singleton
 * row also carries `mode` (added 2026-08-28, cloud-mirror C2a), which IS mutable — `setDeploymentMode`
 * below promotes a mirror to a primary in place (design §10), with no such "already stamped" guard.
 */
export async function stampDeployment(
  db: Database,
  environment: DeploymentEnvironment,
): Promise<void> {
  const existing = await readDeploymentEnvironment(db);
  if (existing === environment) return;
  if (existing !== null) {
    throw new AppError("deployment.already_stamped", {
      stamped: existing,
      requested: environment,
    });
  }
  await db.insert(deployment).values({ id: 1, environment });
}

/** Which role this database plays — a `primary` writes and originates; a `mirror` pulls + applies and
 * serves read-only (C2a design §3). Narrowed to the two-value union for the same reason
 * `DeploymentEnvironment` is: an unrepresentable value is a `tsc` error, not a runtime CHECK violation. */
export type DeploymentMode = "primary" | "mirror";

/** The role this database plays, or `"primary"` when nothing has been stamped — an unstamped database
 * is a primary. Same `to_regclass` probe (not a caught undefined-table error) `readDeploymentEnvironment`
 * uses and for the same reason: a failed statement would poison the caller's transaction. */
export async function readDeploymentMode(db: Database): Promise<DeploymentMode> {
  const present = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('public.deployment') is not null as exists`,
  );
  if (present.rows[0]?.exists !== true) return "primary";
  const rows = await db.execute<{ mode: DeploymentMode }>(
    sql`select mode from deployment where id = 1`,
  );
  return rows.rows[0]?.mode ?? "primary";
}

/** Sets this database's role. Mutable by design — a mirror is PROMOTED to a primary (design §10) — so,
 * unlike `stampDeployment`'s immutable environment, there is no "already stamped" guard. The only
 * non-test caller today is the adopt path, which sets `mirror` at setup (`adoptFromPrimary` → here,
 * `apps/server/src/adopt.ts`); the promotion path (design §10) that will set `primary` back is not
 * built yet. An OWNER-role write: `app_user` holds no UPDATE on `deployment` (the grant read-back
 * asserts it), so this runs on the provisioning/owner connection, never the app pool. Requires the
 * singleton row (stamp the environment first) — a 0-row UPDATE is a silent no-op on an unstamped DB,
 * which never happens for a real mirror. */
export async function setDeploymentMode(db: Database, mode: DeploymentMode): Promise<void> {
  // A read-only mirror holds no singleton duties, so flipping mode to 'mirror' co-sets
  // singleton_role='secondary' in the SAME update — the (mirror, primary) pair deployment_role_valid_ck
  // forbids is never even transiently written. Flipping mode to 'primary' leaves singleton_role
  // untouched: a primary may be the singleton-holder OR a sell-only local secondary (design §2), and
  // which one is the promote action's call, not this setter's.
  const result =
    mode === "mirror"
      ? await db.execute<{ id: number }>(
          sql`update deployment set mode = ${mode}, singleton_role = 'secondary' where id = 1 returning id`,
        )
      : await db.execute<{ id: number }>(
          sql`update deployment set mode = ${mode} where id = 1 returning id`,
        );
  // Fail loud on a 0-row update: the singleton must already exist (stamp first). A silent no-op here
  // would let a mis-sequenced promotion "succeed" while leaving the database in the wrong mode.
  if (result.rows.length === 0) {
    throw new AppError("deployment.not_stamped", {});
  }
}

/** The singleton-ownership axis (promotion runbook design §2), orthogonal to `mode`: a `primary` holds
 * the venue's singleton duties (the AEAT submitter + payment reconciler — #33 §7); a `secondary` sells
 * but holds none. Narrowed to the two-value union for the same reason `DeploymentMode` is: an
 * unrepresentable value is a `tsc` error, not a runtime CHECK violation. */
export type SingletonRole = "primary" | "secondary";

/** Whether this database holds the singleton duties, or `"primary"` when nothing has been stamped — an
 * unstamped database is a sole primary. Same `to_regclass` probe (not a caught undefined-table error)
 * `readDeploymentMode` uses, for the same transaction-poisoning reason. */
export async function readSingletonRole(db: Database): Promise<SingletonRole> {
  const present = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('public.deployment') is not null as exists`,
  );
  if (present.rows[0]?.exists !== true) return "primary";
  const rows = await db.execute<{ singleton_role: SingletonRole }>(
    sql`select singleton_role from deployment where id = 1`,
  );
  return rows.rows[0]?.singleton_role ?? "primary";
}

/**
 * Reads both `deployment` axes — `mode` and `singleton_role` — in a SINGLE query, so the pair is
 * taken from one MVCC snapshot and is always internally consistent. The single-axis readers above
 * (`readDeploymentMode` + `readSingletonRole`) each run their own query, so under READ COMMITTED a
 * concurrent promotion committing between the two reads can hand a caller a torn pair — e.g.
 * `(mirror, primary)`, the exact combination `deployment_role_valid_ck` forbids (a read-only mirror
 * cannot hold singletons) and which therefore never exists in any single committed row. This reader
 * cannot observe that pair: one `select mode, singleton_role from deployment where id = 1` sees both
 * columns as of the same snapshot. Same `to_regclass` existence probe (not a caught undefined-table
 * error) the single-axis readers use and for the same transaction-poisoning reason; the same
 * per-field `?? "primary"` fallback for an unstamped database (a sole primary).
 */
export async function readDeploymentAxes(
  db: Database,
): Promise<{ mode: DeploymentMode; singletonRole: SingletonRole }> {
  const present = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('public.deployment') is not null as exists`,
  );
  if (present.rows[0]?.exists !== true) return { mode: "primary", singletonRole: "primary" };
  const rows = await db.execute<{ mode: DeploymentMode; singleton_role: SingletonRole }>(
    sql`select mode, singleton_role from deployment where id = 1`,
  );
  return {
    mode: rows.rows[0]?.mode ?? "primary",
    singletonRole: rows.rows[0]?.singleton_role ?? "primary",
  };
}

/** Sets this database's singleton-ownership role. An OWNER-role write (app_user holds no UPDATE on
 * deployment), like `setDeploymentMode`; fail-loud on a 0-row update (stamp the environment first).
 * Setting `'primary'` on a `mode='mirror'` database is refused by `deployment_role_valid_ck` — a
 * read-only mirror cannot hold singletons; a promotion flips the mode first (the promote action's job). */
export async function setSingletonRole(db: Database, role: SingletonRole): Promise<void> {
  await db.transaction((tx) => setSingletonRoleTx(tx, role));
}

/** Sets the singleton-ownership role on a caller-provided transaction (see `setSingletonRole` for the
 * full contract — owner-role write, fail-loud on a 0-row update, `deployment_role_valid_ck` refuses
 * `'primary'` on a mirror). Exists so the promotion path (design §10) can commit this flip in the
 * SAME transaction as the membership-document write (`writeNodeMembershipTx`), so both land or neither
 * does. `setSingletonRole` is this on its own transaction. */
export async function setSingletonRoleTx(tx: Transaction, role: SingletonRole): Promise<void> {
  const result = await tx.execute<{ id: number }>(
    sql`update deployment set singleton_role = ${role} where id = 1 returning id`,
  );
  if (result.rows.length === 0) {
    throw new AppError("deployment.not_stamped", {});
  }
}
