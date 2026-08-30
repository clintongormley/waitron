import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { Database } from "@waitron/db";
import "./errors.js";

/**
 * Refuse to enable scheduled backup unless the backup connection can actually read the FORCE-RLS
 * fiscal tables (`registros_facturacion`/`cadenas`/`sync_log`/every tenant table). FORCE ROW LEVEL
 * SECURITY applies to the table owner too, so a connection that is neither SUPERUSER nor BYPASSRLS
 * cannot read them. Under `pg_dump`'s DEFAULT `row_security = off` such a dump ERRORS loudly ("query
 * would be affected by row-level security policy…"); it would instead SILENTLY emit a
 * per-tenant-truncated (empty) dump only if run WITH `--enable-row-security`, which our runner does
 * not pass. Refusing a fenced connection at boot turns a recurring per-run `pg_dump` failure into a
 * single clear boot-time cause, and guarantees we never ship a silently-truncated fiscal backup.
 * `rolsuper OR rolbypassrls` is the exact predicate for "RLS is inert for this role"
 * (`0001_tenancy_rls.sql`: "It does nothing against a superuser — verified"), and needs no seeded
 * fiscal rows to check.
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
