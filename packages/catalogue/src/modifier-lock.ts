import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";

/** Selection readers coexist; definition, attachment and publication writers exclude them. */
export async function lockModifierDefinitions(
  tx: Transaction,
  mode: "read" | "write" = "write",
): Promise<void> {
  const key = "modifier-definitions";
  await tx.execute(
    mode === "read"
      ? sql`select pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`
      : sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}
