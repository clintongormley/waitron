import { and, count, eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import "./errors.js";
import { paymentResolutions } from "./schema/payment-resolutions.js";
import { payments } from "./schema/payments.js";

export interface NewPaymentResolution {
  paymentId: string;
  workingOrderId: string;
  /** The manager who asked for the resolution. */
  personId: string;
  outcome: "captured" | "failed";
  cancelledAtProvider: boolean;
  providerStatus: string | null;
  resolvedAt: Date;
}

export async function recordResolution(
  tx: Transaction,
  r: NewPaymentResolution,
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(paymentResolutions)
    .values({
      paymentId: r.paymentId,
      workingOrderId: r.workingOrderId,
      personId: r.personId,
      outcome: r.outcome,
      cancelledAtProvider: r.cancelledAtProvider,
      providerStatus: r.providerStatus,
      resolvedAt: r.resolvedAt.toISOString(),
    })
    .returning({ id: paymentResolutions.id });
  return row!;
}

/** `recordResolution` for the payment `key` names, on the working order it belongs to. Throws
 * `payment.not_found` when no payment has that key. */
export async function recordAttemptResolution(
  tx: Transaction,
  key: { provider: string; paymentRef: string },
  r: Omit<NewPaymentResolution, "paymentId" | "workingOrderId">,
): Promise<{ id: string }> {
  const [payment] = await tx
    .select({ id: payments.id, workingOrderId: payments.workingOrderId })
    .from(payments)
    .where(and(eq(payments.provider, key.provider), eq(payments.paymentRef, key.paymentRef)));
  if (payment === undefined) throw new AppError("payment.not_found", key);
  return recordResolution(tx, {
    ...r,
    paymentId: payment.id,
    workingOrderId: payment.workingOrderId,
  });
}

/** How many of this working order's payments a resolution left cancelled at the provider — with
 * `provider`, only that provider's payments. */
export async function countProviderCancelledResolutions(
  tx: Transaction,
  params: { provider?: string; workingOrderId: string },
): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(paymentResolutions)
    .innerJoin(payments, eq(payments.id, paymentResolutions.paymentId))
    .where(
      and(
        eq(paymentResolutions.workingOrderId, params.workingOrderId),
        eq(paymentResolutions.cancelledAtProvider, true),
        params.provider === undefined ? undefined : eq(payments.provider, params.provider),
      ),
    );
  return row!.n;
}
