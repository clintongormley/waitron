import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { Database } from "./client.js";
import { deployment } from "./schema/deployment.js";
import "./errors.js";

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
 */
export async function readDeploymentEnvironment(db: Database): Promise<string | null> {
  const present = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('public.deployment') is not null as exists`,
  );
  if (present.rows[0]?.exists !== true) return null;

  const rows = await db.execute<{ environment: string }>(
    sql`select environment from deployment where id = 1`,
  );
  return rows.rows[0]?.environment ?? null;
}

/**
 * Records which environment this database belongs to. Idempotent for the same value; a DIFFERENT
 * value is refused rather than overwritten, because the rows already written under the first one
 * cannot be moved (the design's §2).
 */
export async function stampDeployment(db: Database, environment: string): Promise<void> {
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
