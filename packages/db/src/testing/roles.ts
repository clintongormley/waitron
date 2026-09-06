import { sql } from "drizzle-orm";
import type { Transaction } from "../client.js";

/**
 * Switches the current transaction to the non-owner application role.
 *
 * Queries then run with app_user's grants instead of the connection owner's privileges.
 *
 * `set local` rather than `set`: the role reverts at transaction end, so a
 * pooled connection is never handed back wearing the wrong role.
 */
export async function asAppUser(tx: Transaction): Promise<void> {
  await tx.execute(sql`set local role app_user`);
}
