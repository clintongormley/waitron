import type { payments } from "@waitron/payments";
import { centsToDecimal, compareDecimal, decimal } from "@waitron/shared";

type Capture = typeof payments.$inferSelect;

export function matchTenderRefundCapture(
  tender: { saleId: string; billPaymentId: string | null; amount: string },
  captures: readonly Capture[],
  directCardCount: number,
): Capture | undefined {
  // Direct tenders carry no capture key; multiple direct cards cannot be paired by amount.
  if (tender.billPaymentId === null && directCardCount !== 1) return undefined;
  const matching = captures.filter(
    (capture) =>
      (tender.billPaymentId === null
        ? capture.saleId === tender.saleId && capture.billPaymentId === null
        : capture.billPaymentId === tender.billPaymentId) &&
      ["captured", "settled", "partially_refunded", "refunded"].includes(capture.state),
  );
  if (matching.length !== 1) return undefined;
  const capture = matching[0]!;
  if (
    tender.billPaymentId === null &&
    compareDecimal(centsToDecimal(capture.amount), decimal(tender.amount)) !== 0
  )
    return undefined;
  return capture;
}
