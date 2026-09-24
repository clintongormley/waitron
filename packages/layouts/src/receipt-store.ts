import { nowIso, tenantReceipts } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { DEFAULT_RECEIPT } from "./defaults.js";
import type { ReceiptConfig } from "./types.js";
import { validateReceiptConfig } from "./validate.js";

/**
 * `getReceipt` reads the document back without re-validating it: `putReceipt` validates before it
 * writes.
 * The `as` cast restores a type the JSON column does not carry: this package depends on
 * `@waitron/db`, so the column cannot name one of its types without a dependency cycle.
 */
export async function getReceipt(tx: Transaction): Promise<ReceiptConfig> {
  const [row] = await tx.select({ receipt: tenantReceipts.receipt }).from(tenantReceipts);
  if (row === undefined) return DEFAULT_RECEIPT;
  return row.receipt as ReceiptConfig;
}

export async function putReceipt(
  tx: Transaction,
  input: { managementSessionId: string; receipt: unknown },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "layout.configure",
  });
  const receipt = validateReceiptConfig(input.receipt);
  await tx
    .insert(tenantReceipts)
    .values({ receipt })
    .onConflictDoUpdate({
      target: tenantReceipts.id,
      set: { receipt, updatedAt: nowIso() },
    });
}
