import { sql } from "drizzle-orm";
import type { Transaction } from "../client.js";

/**
 * Switches the current transaction to the non-owner application role.
 *
 * Every RLS assertion in this repository goes through here. PGlite runs as
 * superuser and superusers bypass RLS unconditionally — with ENABLE and with
 * FORCE alike — so a test that reads without this call is measuring nothing.
 *
 * `set local` rather than `set`: the role reverts at transaction end, so a
 * pooled connection is never handed back wearing the wrong role.
 */
export async function asAppUser(tx: Transaction): Promise<void> {
  await tx.execute(sql`set local role app_user`);
}
