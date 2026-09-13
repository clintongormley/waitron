import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";

/** Attachments, publication and definition edits share a lock so dependency checks cannot race. */
export async function lockModifierDefinitions(tx: Transaction, tenantId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`modifier-definitions:${tenantId}`}, 0))`,
  );
}
