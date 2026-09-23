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
 * `tsc` error instead of a runtime `deployment_environment_ck` violation discovered only once
 * `stampDeployment` has already run. Same defect class `packages/fiscal-verifactu`'s
 * `Entorno` (`registro-row.ts`) closes one layer down.
 */
export type DeploymentEnvironment = "production" | "preproduction";

/**
 * Whether the `deployment` table exists in the file behind this handle.
 *
 * **`sqlite_master` rather than `pragma table_info`, because a table name BINDS here.** Measured on
 * Node v26.7.0 against `node:sqlite`: `pragma table_info(?)` is refused at prepare time with
 * `near "?": syntax error`, and the same pragma with the name written into the statement text
 * returns its rows — so a pragma probe would have to build SQL by concatenation, which `CLAUDE.md`
 * §3 allows only with an escape or a validate-and-throw. A catalogue read needs neither.
 *
 * **Probing at all, rather than running the read and catching the refusal**, is what lets these
 * readers keep their contract of answering for a database whose migrations have not run: catching
 * would mean matching the engine's refusal text, which is a string this repository does not own.
 *
 * The catalogue is per FILE — a venue handle sees the venue file's tables and nothing else, pinned
 * by `packages/store/src/index.test.ts`.
 *
 * {@link readMirrorConfig} and {@link readNodeMembership} probe their own tables the same way and
 * point here for the reason.
 *
 * Exported because one caller outside this file needs the two halves of {@link
 * readDeploymentEnvironment}'s `null` told apart: `waitron-provision venue` STAMPS a migrated
 * directory that carries no row, and must refuse one whose schema was never created at all, where
 * the insert would be met by `no such table: deployment`. Every other caller must keep treating the
 * two as one thing — see the `null` paragraph below.
 */
export async function deploymentTableExists(db: Database): Promise<boolean> {
  const present = await db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name = ${"deployment"}`,
  );
  return present.rows.length > 0;
}

/**
 * The environment this database was stamped for, or `null` if it has none.
 *
 * `null` covers BOTH "the table does not exist yet" and "the table is empty", and callers must not
 * try to tell them apart: on a first-ever boot the migration that creates the table has not run,
 * and on a database predating this feature the table exists but is empty. Both mean the same
 * thing — nothing recorded what this database is for — and both are handled identically.
 *
 * {@link deploymentTableExists} is what makes the first half of that true — see it for why the
 * existence of the table is read off the catalogue rather than discovered by running the select.
 *
 * The return type is narrowed to `DeploymentEnvironment | null`, not a bare `string`, because
 * the `deployment_environment_ck` check in `./schema/deployment.js` is what makes this honest: no
 * row can exist in this column outside `'production'`/`'preproduction'`, so a value read back here
 * is one of those two by construction, never a value merely assumed to be safe.
 */
export async function readDeploymentEnvironment(
  db: Database,
): Promise<DeploymentEnvironment | null> {
  if (!(await deploymentTableExists(db))) return null;

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

/** Which role this database plays — a `primary` writes and originates; a `mirror` holds no singleton
 * duties and boots behind a read-only gate, its node-scoped reads pointed at the primary it was
 * adopted from (`mirror_config.origin_node_id`). Nothing copies a venue's rows onto a mirror, and no
 * adopted mirror reaches that boot today (`apps/server/src/finish-adoption.ts`'s `PendingAdoption`
 * header). Narrowed to the two-value union for the same reason `DeploymentEnvironment` is: an
 * unrepresentable value is a `tsc` error, not a runtime CHECK violation. */
export type DeploymentMode = "primary" | "mirror";

/** The role this database plays, or `"primary"` when nothing has been stamped — an unstamped database
 * is a primary. Answers for a table that does not exist yet as well as for one holding no row, through
 * the same {@link deploymentTableExists} probe `readDeploymentEnvironment` uses. */
export async function readDeploymentMode(db: Database): Promise<DeploymentMode> {
  if (!(await deploymentTableExists(db))) return "primary";
  const rows = await db.execute<{ mode: DeploymentMode }>(
    sql`select mode from deployment where id = 1`,
  );
  return rows.rows[0]?.mode ?? "primary";
}

/** Sets this database's role. Mutable by design — a mirror is PROMOTED to a primary (design §10) —
 * so, unlike `stampDeployment`'s immutable environment, there is no "already stamped" guard. The
 * only non-test caller today is the adopt path, which sets `mirror` at setup (`adoptFromPrimary` →
 * here, `apps/server/src/adopt.ts`); the promotion path (design §10) that will set `primary` back
 * is not built yet. **Nothing in the database refuses this write.** It was an owner-role write on
 * PostgreSQL, where `app_user` held no UPDATE on `deployment`; this engine has no roles and no
 * grants, and `deployment` carries no trigger, so an `update deployment …` on an ordinary handle
 * succeeds — measured 2026-09-23 on Node v26.7.0 against the core migration set. Which code may set
 * the mode is now a convention the callers keep, nothing more. Requires the singleton row (stamp
 * the environment first) — a 0-row UPDATE is a silent no-op on an unstamped DB, which never happens
 * for a real mirror. */
export async function setDeploymentMode(db: Database, mode: DeploymentMode): Promise<void> {
  await db.withWriteLock(async () => setDeploymentModeTx(db, mode));
}

/** Sets this database's role on a caller-provided transaction (see `setDeploymentMode` for the full
 * contract — mirror co-sets `singleton_role='secondary'` in the same update, primary leaves it
 * untouched, fail-loud on a 0-row update). Exists so a caller can commit this flip in the SAME
 * transaction as a related write (CLAUDE.md §3) — R3b's mirror→primary promote commits it with the
 * membership-document write (`persistNodeMembershipIfNewerTx`) so both land or neither does (spec §8
 * "R3 sharp edge"). `setDeploymentMode` is this on its own transaction. */
export async function setDeploymentModeTx(tx: Transaction, mode: DeploymentMode): Promise<void> {
  // A read-only mirror holds no singleton duties, so flipping mode to 'mirror' co-sets
  // singleton_role='secondary' in the SAME update — the (mirror, primary) pair deployment_role_valid_ck
  // forbids is never even transiently written. Flipping mode to 'primary' leaves singleton_role
  // untouched: a primary may be the singleton-holder OR a sell-only local secondary (design §2), and
  // which one is the promote action's call, not this setter's.
  const result =
    mode === "mirror"
      ? await tx.execute<{ id: number }>(
          sql`update deployment set mode = ${mode}, singleton_role = 'secondary' where id = 1 returning id`,
        )
      : await tx.execute<{ id: number }>(
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
 * unstamped database is a sole primary. Answers for a missing table as well as an empty one, through the
 * same {@link deploymentTableExists} probe `readDeploymentMode` uses. */
export async function readSingletonRole(db: Database): Promise<SingletonRole> {
  if (!(await deploymentTableExists(db))) return "primary";
  const rows = await db.execute<{ singleton_role: SingletonRole }>(
    sql`select singleton_role from deployment where id = 1`,
  );
  return rows.rows[0]?.singleton_role ?? "primary";
}

/**
 * Reads both `deployment` axes — `mode` and `singleton_role` — in a SINGLE query, so the pair always
 * comes from one row and is internally consistent. The single-axis readers above
 * (`readDeploymentMode` + `readSingletonRole`) each run their own query, so a promotion committing
 * between the two reads can hand a caller a torn pair — e.g. `(mirror, primary)`, the exact
 * combination `deployment_role_valid_ck` forbids (a read-only mirror cannot hold singletons) and
 * which therefore never exists in any single committed row. This reader cannot observe that pair:
 * one `select mode, singleton_role from deployment where id = 1` reads both columns out of the same
 * row. Same {@link deploymentTableExists} probe the single-axis readers use, and the same per-field
 * `?? "primary"` fallback for an unstamped database (a sole primary).
 */
export async function readDeploymentAxes(
  db: Database,
): Promise<{ mode: DeploymentMode; singletonRole: SingletonRole }> {
  if (!(await deploymentTableExists(db))) return { mode: "primary", singletonRole: "primary" };
  const rows = await db.execute<{ mode: DeploymentMode; singleton_role: SingletonRole }>(
    sql`select mode, singleton_role from deployment where id = 1`,
  );
  return {
    mode: rows.rows[0]?.mode ?? "primary",
    singletonRole: rows.rows[0]?.singleton_role ?? "primary",
  };
}

/** Sets this database's singleton-ownership role. Nothing in the database refuses this write, for
 * the reason `setDeploymentMode` states; fail-loud on a 0-row update (stamp the environment first).
 * Setting `'primary'` on a `mode='mirror'` database is refused by `deployment_role_valid_ck` — a
 * read-only mirror cannot hold singletons; a promotion flips the mode first (the promote action's job). */
export async function setSingletonRole(db: Database, role: SingletonRole): Promise<void> {
  await db.withWriteLock(async () => setSingletonRoleTx(db, role));
}

/** Sets the singleton-ownership role on a caller-provided transaction (see `setSingletonRole` for the
 * full contract — nothing in the database refuses it, fail-loud on a 0-row update,
 * `deployment_role_valid_ck` refuses `'primary'` on a mirror). Exists so a caller can commit this
 * flip in the SAME transaction as a related write (CLAUDE.md §3: a caller that must write atomically with another write shares one
 * transaction) — the promotion path (spec `2026-09-03-reserved-standby-identity-and-promotion-design.md`
 * §6 R1) commits it with the membership-document write (`writeNodeMembershipTx`), so both land or neither
 * does. `setSingletonRole` is this on its own transaction. */
export async function setSingletonRoleTx(tx: Transaction, role: SingletonRole): Promise<void> {
  const result = await tx.execute<{ id: number }>(
    sql`update deployment set singleton_role = ${role} where id = 1 returning id`,
  );
  if (result.rows.length === 0) {
    throw new AppError("deployment.not_stamped", {});
  }
}

/** The stored scrypt verifier of the offline break-glass secret, or `null` when unset — a node
 * minted before this column, an unstamped database, or the primary (never promoted) all read `null`.
 * A plain `select … limit 1` (not the {@link deploymentTableExists} probe the axis readers use): the
 * singleton row's absence already reads `null` via `row?.v ?? null`, and every caller of this holds a
 * stamped database. Never returns the break-glass SECRET — only the verifier stored against it. */
export async function readBreakGlassVerifier(db: Database | Transaction): Promise<string | null> {
  const [row] = await db.select({ v: deployment.breakGlassVerifier }).from(deployment).limit(1);
  return row?.v ?? null;
}

/** Writes the break-glass verifier onto the singleton `deployment` row, on a caller-provided
 * transaction so a promotion can commit it atomically with its other writes (CLAUDE.md §3).
 *
 * **Nothing refuses another writer this column.** The spec (§9.3) reserves it for the promotion
 * path, and on PostgreSQL the database held that line: `app_user` was refused the UPDATE with
 * `42501`. That case is gone with the roles — `deployment.break-glass.test.ts`'s own header records
 * its deletion as a loss — and an `update deployment set break_glass_verifier = …` on an ordinary
 * handle now succeeds, measured 2026-09-23 on Node v26.7.0 against the core migration set. The rule
 * survives only as a convention the callers keep.
 *
 * Requires the singleton row (stamp the environment first); on an unstamped database the UPDATE is a
 * silent 0-row no-op, which never happens for a node reaching promotion. */
export async function setBreakGlassVerifierTx(tx: Transaction, verifier: string): Promise<void> {
  await tx.update(deployment).set({ breakGlassVerifier: verifier });
}
