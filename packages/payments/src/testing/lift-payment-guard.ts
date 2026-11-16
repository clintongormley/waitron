import { sql } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";

export async function liftPaymentGuard(
  db: Database | Transaction,
  write: () => unknown,
): Promise<void> {
  const { rows } = await db.execute<{ sql: string }>(
    sql`select sql from sqlite_master where type = 'trigger' and name = 'payments_guard_update'`,
  );
  await db.execute(sql`drop trigger payments_guard_update`);
  try {
    await write();
  } finally {
    await db.execute(sql.raw(rows[0]!.sql));
  }
}
