import type { Decimal } from "@waitron/shared";
import type { Database } from "@waitron/db";
import { reversePayment } from "@waitron/payments";
import type { PaymentResult } from "@waitron/payments";
import type { SumUpClient } from "./client.js";
import { SUMUP_PROVIDER } from "./client.js";

export function reverseViaSumUp(
  db: Database,
  client: Pick<SumUpClient, "refund">,
  ref: string,
  kind: "void" | "refund",
  amount: Decimal | undefined,
): Promise<PaymentResult> {
  return reversePayment(
    db,
    { provider: SUMUP_PROVIDER, paymentRef: ref, kind, amount },
    async (externalRef) => {
      const outcome = await client.refund({
        transactionId: externalRef,
        ...(amount ? { amount } : {}),
      });
      return outcome.status;
    },
  );
}
