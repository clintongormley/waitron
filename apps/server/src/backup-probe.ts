import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { Database } from "@waitron/db";
import "./errors.js";

/**
 * Apply the backup connection gate: accept a superuser or BYPASSRLS role.
 * A refused connection reports backup.role_rls_fenced. This role check does not
 * inspect table privileges.
 */
export async function assertBackupCanReadFiscal(db: Database): Promise<void> {
  // The same rolsuper-or-rolbypassrls predicate lives in scripts/dev-setup.ts's inspectVenues; keep them in step.
  const rows = await db.execute<{ can_bypass: boolean }>(
    sql`select (rolsuper or rolbypassrls) as can_bypass from pg_roles where rolname = current_user`,
  );
  if (rows.rows[0]?.can_bypass !== true) {
    throw new AppError("backup.role_rls_fenced", {});
  }
}
