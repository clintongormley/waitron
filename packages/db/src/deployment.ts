import { eq, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { Database, Transaction } from "./client.js";
import { now } from "./schema/columns.js";
import { deployment } from "./schema/deployment.js";
import { nodeRoles } from "./schema/node-roles.js";
import "./errors.js";

/**
 * Which environment a database can be stamped for. A package-local union, deliberately NOT
 * `apps/server`'s identically-shaped `DeploymentEnvironment` type — this package must never import
 * from `apps/server` — but a union all the same, so an unrepresentable value is a `tsc` error
 * instead of a runtime `deployment_environment_ck` violation.
 */
export type DeploymentEnvironment = "production" | "preproduction";

/**
 * Whether the `deployment` table exists in the file behind this handle.
 *
 * **`sqlite_master` rather than `pragma table_info`, because a table name BINDS here.**
 * `pragma table_info(?)` is refused at prepare time, so a pragma probe would have to build SQL by
 * concatenation, which `CLAUDE.md` §3 allows only with an escape or a validate-and-throw.
 *
 * **Probing at all, rather than running the read and catching the refusal**, is what lets these
 * readers keep their contract of answering for a database whose migrations have not run: catching
 * would mean matching the engine's refusal text, which is a string this repository does not own.
 *
 * Exported because `waitron-provision venue` must tell the two halves of {@link
 * readDeploymentEnvironment}'s `null` apart. Every other caller must keep treating the two as one
 * thing.
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
 * try to tell them apart: both mean nothing recorded what this database is for.
 *
 * The narrowed return type is honest because the `deployment_environment_ck` check in
 * `./schema/deployment.js` admits no other value into the column.
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
 * cannot be moved.
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

/** Which role a node plays — a `primary` writes and originates; a `mirror` holds no singleton duties
 * and boots behind a read-only gate. */
export type DeploymentMode = "primary" | "mirror";

/** Whether a node holds the venue's singleton duties (the AEAT submitter and payment reconciler) —
 * `primary` — or sells only. */
export type SingletonRole = "primary" | "secondary";

/** Whether `node_roles` exists behind this handle — read off the catalogue for the reason given on
 * {@link deploymentTableExists}. */
async function nodeRolesTableExists(db: Database): Promise<boolean> {
  const present = await db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name = ${"node_roles"}`,
  );
  return present.rows.length > 0;
}

/**
 * Both of one node's axes, `mode` and `singleton_role`, from ONE read of that node's row, so the
 * pair is never torn — never the `(mirror, primary)` pair `node_roles_role_valid_ck` forbids. A
 * node with no row, or a database whose migrations have not run, reads as a sole primary: a box
 * between its first migration and its first role write must still sell.
 */
export async function readDeploymentAxes(
  db: Database,
  nodeId: string,
): Promise<{ mode: DeploymentMode; singletonRole: SingletonRole }> {
  if (!(await nodeRolesTableExists(db))) return { mode: "primary", singletonRole: "primary" };
  const [row] = await db
    .select({ mode: nodeRoles.mode, singletonRole: nodeRoles.singletonRole })
    .from(nodeRoles)
    .where(eq(nodeRoles.nodeId, nodeId));
  return { mode: row?.mode ?? "primary", singletonRole: row?.singletonRole ?? "primary" };
}

/** One node's mode; see {@link readDeploymentAxes}. */
export async function readDeploymentMode(db: Database, nodeId: string): Promise<DeploymentMode> {
  return (await readDeploymentAxes(db, nodeId)).mode;
}

/** One node's singleton role; see {@link readDeploymentAxes}. */
export async function readSingletonRole(db: Database, nodeId: string): Promise<SingletonRole> {
  return (await readDeploymentAxes(db, nodeId)).singletonRole;
}

/**
 * Refuses a role write on a database that has not been stamped with its environment. These are
 * promotion primitives: a mis-sequenced adopt or promote that "succeeded" before the stamp would
 * leave a node's role recorded on a database nothing has claimed for an environment.
 */
async function requireStamp(tx: Transaction): Promise<void> {
  const [row] = await tx.select({ id: deployment.id }).from(deployment).where(eq(deployment.id, 1));
  if (row === undefined) throw new AppError("deployment.not_stamped", {});
}

/** Sets one node's mode, on its own write transaction. See {@link setDeploymentModeTx}. */
export async function setDeploymentMode(
  db: Database,
  nodeId: string,
  mode: DeploymentMode,
): Promise<void> {
  await db.withWriteLock(async () => setDeploymentModeTx(db, nodeId, mode));
}

/**
 * Sets one node's mode on a caller's transaction, creating the node's row if it has none. `mirror`
 * co-sets `singleton_role = 'secondary'` in the same write, so the pair `node_roles_role_valid_ck`
 * forbids is never written even transiently; `primary` leaves `singleton_role` as it is. Nothing in
 * the database refuses another caller this write. `scripts/write-path-tables.test.ts` flags a
 * `node_roles` write written in one of the statement or builder shapes its `detector` matches, in
 * the production source under each app's and package's `src`, outside this file; its header lists
 * what it cannot see.
 */
export async function setDeploymentModeTx(
  tx: Transaction,
  nodeId: string,
  mode: DeploymentMode,
): Promise<void> {
  await requireStamp(tx);
  await tx
    .insert(nodeRoles)
    .values({ nodeId, mode, singletonRole: mode === "mirror" ? "secondary" : "primary" })
    .onConflictDoUpdate({
      target: nodeRoles.nodeId,
      set:
        mode === "mirror"
          ? { mode, singletonRole: "secondary", updatedAt: now() }
          : { mode, updatedAt: now() },
    });
}

/** Sets one node's singleton role, on its own write transaction. See {@link setSingletonRoleTx}. */
export async function setSingletonRole(
  db: Database,
  nodeId: string,
  role: SingletonRole,
): Promise<void> {
  await db.withWriteLock(async () => setSingletonRoleTx(db, nodeId, role));
}

/** Sets one node's singleton role on a caller's transaction, creating the node's row (mode
 * `primary`) if it has none. `'primary'` on a node whose mode is `mirror` is refused by
 * `node_roles_role_valid_ck`: a promotion flips the mode first. */
export async function setSingletonRoleTx(
  tx: Transaction,
  nodeId: string,
  role: SingletonRole,
): Promise<void> {
  await requireStamp(tx);
  await tx
    .insert(nodeRoles)
    .values({ nodeId, singletonRole: role })
    .onConflictDoUpdate({
      target: nodeRoles.nodeId,
      set: { singletonRole: role, updatedAt: now() },
    });
}

/** One node's stored break-glass verifier, or `null` when it has none. Never the secret. No
 * {@link nodeRolesTableExists} probe: its one caller, `verifyBreakGlass` behind the promote route,
 * runs only on a server that has already applied its migrations. */
export async function readBreakGlassVerifier(
  db: Database | Transaction,
  nodeId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ v: nodeRoles.breakGlassVerifier })
    .from(nodeRoles)
    .where(eq(nodeRoles.nodeId, nodeId));
  return row?.v ?? null;
}

/** Writes one node's break-glass verifier on a caller's transaction, creating the node's row if it
 * has none. The one product writer is adopt, through `mintBreakGlassSecret`
 * (`apps/server/src/break-glass.ts`); nothing in the database refuses another writer. */
export async function setBreakGlassVerifierTx(
  tx: Transaction,
  nodeId: string,
  verifier: string,
): Promise<void> {
  await requireStamp(tx);
  await tx
    .insert(nodeRoles)
    .values({ nodeId, breakGlassVerifier: verifier })
    .onConflictDoUpdate({
      target: nodeRoles.nodeId,
      set: { breakGlassVerifier: verifier, updatedAt: now() },
    });
}
