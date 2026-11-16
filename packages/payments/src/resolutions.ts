import { and, count, eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import "./errors.js";
import { payments } from "./schema/payments.js";

export async function recordAttemptResolution(
  tx: Transaction,
  key: { provider: string; paymentRef: string },
  r: {
    personId: string | null;
    outcome: "captured" | "failed";
    cancelledAtProvider: boolean;
    providerStatus: string | null;
    resolvedAt: Date;
  },
): Promise<void> {
  const [row] = await tx
    .update(payments)
    .set({
      resolutionOutcome: r.outcome,
      resolutionCancelledAtProvider: r.cancelledAtProvider,
      resolutionProviderStatus: r.providerStatus,
      resolvedBy: r.personId,
      resolvedAt: r.resolvedAt.toISOString(),
    })
    .where(and(eq(payments.provider, key.provider), eq(payments.paymentRef, key.paymentRef)))
    .returning({ id: payments.id });
  if (row === undefined) throw new AppError("payment.not_found", key);
}

export async function countProviderCancelledResolutions(
  tx: Transaction,
  params: { provider?: string; workingOrderId: string },
): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(payments)
    .where(
      and(
        eq(payments.workingOrderId, params.workingOrderId),
        eq(payments.resolutionCancelledAtProvider, true),
        params.provider === undefined ? undefined : eq(payments.provider, params.provider),
      ),
    );
  return row!.n;
}
