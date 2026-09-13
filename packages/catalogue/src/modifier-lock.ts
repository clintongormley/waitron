import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";

/** Selection readers coexist; definition, attachment and publication writers exclude them. */
export async function lockModifierDefinitions(
  tx: Transaction,
  tenantId: string,
  mode: "read" | "write" = "write",
): Promise<void> {
  const key = `modifier-definitions:${tenantId}`;
  await tx.execute(
    mode === "read"
      ? sql`select pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`
      : sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}
