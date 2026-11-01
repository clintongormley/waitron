import { eq, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { Database, Transaction } from "./client.js";
import { deployment } from "./schema/deployment.js";
import { tableExists } from "./table-exists.js";
import "./errors.js";

/**
 * Which environment a database can be stamped for. A union, not a bare `string`, so an
 * unrepresentable value is a `tsc` error instead of a runtime `deployment_environment_ck` violation.
 */
export type DeploymentEnvironment = "production" | "preproduction";

/**
 * The environment a `WAITRON_ENV` value names, or `null` when it names none; the caller refuses
 * `null` with its own error code. Absent, `""` and `dev` mean `preproduction`; `production` must be
 * typed out exactly, because a production invoice number can never be reused, so a mistake has to
 * land on the harmless value. Nothing else is rounded to the nearer word.
 */
export function deploymentEnvironmentFor(raw: string | undefined): DeploymentEnvironment | null {
  if (raw === undefined || raw === "" || raw === "dev") return "preproduction";
  if (raw === "production" || raw === "preproduction") return raw;
  return null;
}

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
  return tableExists(db, "deployment");
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

/** Refuses a role write on a database that has not been stamped with its environment. */
export async function requireStamp(tx: Transaction): Promise<void> {
  const [row] = await tx.select({ id: deployment.id }).from(deployment).where(eq(deployment.id, 1));
  if (row === undefined) throw new AppError("deployment.not_stamped", {});
}
