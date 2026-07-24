import { eq } from "drizzle-orm";
import { compareDecimal, decimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { paymentPolicy } from "./schema/payment-policy.js";

/** A tenant's offline policy as the store reads it back. `offlineAmountCap` is the raw
 * numeric-column string (never a float). */
export interface PaymentPolicyRow {
  offlineMode: "accept_offline" | "cash_only";
  offlineAmountCap: string;
}

/** Read a tenant's offline policy row, or `undefined` when none is configured. A missing row is
 * meaningful: `resolveOfflineDecision` treats it as fail-safe (refuse). */
export async function getPaymentPolicy(
  tx: Transaction,
  tenantId: string,
): Promise<PaymentPolicyRow | undefined> {
  const [row] = await tx
    .select({
      offlineMode: paymentPolicy.offlineMode,
      offlineAmountCap: paymentPolicy.offlineAmountCap,
    })
    .from(paymentPolicy)
    .where(eq(paymentPolicy.tenantId, tenantId));
  return row as PaymentPolicyRow | undefined;
}

/**
 * The pure offline-acceptance gate. Given the tenant's policy (or `undefined` when unconfigured),
 * the per-transaction staff consent, and the amount, decide whether an offline card may be accepted.
 * Fail-safe: no consent, no policy row, `cash_only`, or over the cap all refuse. Only a configured
 * `accept_offline` tenant, with explicit consent, at or under the cap accepts. Nothing goes offline
 * silently — three independent gates must all pass.
 */
export function resolveOfflineDecision(
  policy: PaymentPolicyRow | undefined,
  allowOffline: boolean,
  amount: Decimal,
): "accept" | "refuse" {
  if (!allowOffline) return "refuse";
  if (policy === undefined) return "refuse";
  if (policy.offlineMode !== "accept_offline") return "refuse";
  // compareDecimal(amount, cap) > 0 means amount > cap → over the cap → refuse.
  if (compareDecimal(amount, decimal(policy.offlineAmountCap)) > 0) return "refuse";
  return "accept";
}
