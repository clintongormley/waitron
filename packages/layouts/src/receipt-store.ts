import { tenantReceipts } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { eq, sql } from "drizzle-orm";
import { DEFAULT_RECEIPT } from "./defaults.js";
import type { ReceiptConfig } from "./types.js";
import { validateReceiptConfig } from "./validate.js";

/**
 * The get/put service over `tenant_receipts` (SP-B4; design §9). ONE row per tenant, keyed on
 * `tenant_id`, which doubles as the `ON CONFLICT` target — the tenant_themes shape. Every function
 * takes a `(tx, …)` the CALLER has already scoped (`withTenant` + `asAppUser`), so RLS supplies
 * `current_tenant_id()` and no function here sets a GUC. Proven under that shape in
 * receipt-store.test.ts (real Postgres, as a non-superuser `app_user` member — PGlite holds every
 * grant, §4).
 *
 * `putReceipt` runs, in order: (1) `authorizeManager(..., "till.configure")` — the write gate, before
 * any DB write, proven by-deletion; (2) `validateReceiptConfig` — fail-closed (throws `receipt.invalid`
 * before the write); (3) `INSERT … ON CONFLICT (tenant_id) DO UPDATE`. `getReceipt` casts the opaque
 * jsonb back WITHOUT re-validating (the write validated it, the only writer is this service) and
 * returns DEFAULT_RECEIPT when the tenant has no row (the get-with-default the till boot relies on).
 */

/** The tenant's authored receipt trim, or DEFAULT_RECEIPT (`{}`) when it has never authored one. */
export async function getReceipt(tx: Transaction, tenantId: string): Promise<ReceiptConfig> {
  const [row] = await tx
    .select({ receipt: tenantReceipts.receipt })
    .from(tenantReceipts)
    .where(eq(tenantReceipts.tenantId, tenantId));
  if (row === undefined) return DEFAULT_RECEIPT;
  return row.receipt as ReceiptConfig;
}

/** Author (create or replace) the tenant's receipt trim. Manager/admin only (`till.configure`). */
export async function putReceipt(
  tx: Transaction,
  input: { managementSessionId: string; tenantId: string; receipt: unknown },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "till.configure",
  });
  const receipt = validateReceiptConfig(input.receipt);
  await tx
    .insert(tenantReceipts)
    .values({ tenantId: input.tenantId, receipt })
    .onConflictDoUpdate({
      target: tenantReceipts.tenantId,
      set: { receipt, updatedAt: sql`now()` },
    });
}
