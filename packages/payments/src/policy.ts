import { eq } from "drizzle-orm";
import { centsToDecimal, compareDecimal, decimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { paymentPolicy } from "./schema/payment-policy.js";

/** The venue's offline policy as the store reads it back. `offlineAmountCap` is an exact decimal
 * literal such as "50.00" (never a float), converted from the column's count of cents by the read
 * below. */
export interface PaymentPolicyRow {
  offlineMode: "accept_offline" | "cash_only";
  offlineAmountCap: string;
}

/** Read the venue's offline policy row (`id = 1`), or `undefined` when none is configured. A missing
 * row is meaningful: `resolveOfflineDecision` treats it as fail-safe (refuse). */
export async function getPaymentPolicy(tx: Transaction): Promise<PaymentPolicyRow | undefined> {
  const [row] = await tx
    .select({
      offlineMode: paymentPolicy.offlineMode,
      offlineAmountCap: paymentPolicy.offlineAmountCap,
    })
    .from(paymentPolicy)
    .where(eq(paymentPolicy.id, 1));
  if (row === undefined) return undefined;
  // The cap column holds cents; every comparison above this line is on the decimal type.
  return {
    ...row,
    offlineAmountCap: centsToDecimal(row.offlineAmountCap),
  } as PaymentPolicyRow;
}

/** Fail-safe: only a configured `accept_offline` policy, with explicit staff consent, at or under
 * the cap accepts. */
export function resolveOfflineDecision(
  policy: PaymentPolicyRow | undefined,
  allowOffline: boolean,
  amount: Decimal,
): "accept" | "refuse" {
  if (!allowOffline) return "refuse";
  if (policy === undefined) return "refuse";
  if (policy.offlineMode !== "accept_offline") return "refuse";
  if (compareDecimal(amount, decimal(policy.offlineAmountCap)) > 0) return "refuse";
  return "accept";
}
