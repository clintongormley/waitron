import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { Database } from "@waitron/db";
import "./errors.js";

/**
 * Check schema access and SELECT on user tables and sequences, including migration journals.
 * The backup worker reads the journals and runs pg_dump over this connection. Ownership or
 * effective read grants suffice. A missing privilege reports backup.role_rls_fenced.
 * This is a boot-time check; pg_dump still reports failures if privileges change afterwards.
 */
export async function assertBackupCanReadFiscal(db: Database): Promise<void> {
  const rows = await db.execute<{ can_read: boolean }>(sql`
    select not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
        and c.relkind in ('r', 'p', 'm', 'S')
        and (not has_schema_privilege(n.oid, 'USAGE') or not (
          case when c.relkind = 'S' then has_sequence_privilege(c.oid, 'SELECT')
          else has_table_privilege(c.oid, 'SELECT') end
        ))
    ) as can_read`);
  if (rows.rows[0]?.can_read !== true) {
    throw new AppError("backup.role_rls_fenced", {});
  }
}
