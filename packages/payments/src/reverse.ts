import "./errors.js";
import { AppError, decimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import type { PaymentResult } from "./provider.js";
import {
  assertReversible,
  findPaymentByRef,
  recordFailedRefund,
  recordRefund,
  recordVoid,
} from "./store.js";

// The provider call stays outside both transactions: it can wait on the network.
export async function reversePayment(
  db: Database,
  request: {
    provider: string;
    paymentRef: string;
    kind: "void" | "refund";
    amount: Decimal | undefined;
  },
  send: (externalRef: string) => Promise<"accepted" | "refused">,
): Promise<PaymentResult> {
  const { provider, paymentRef, kind, amount } = request;
  const key = { provider, paymentRef };
  const found = await withTransaction(db, async (tx) => {
    const row = await findPaymentByRef(tx, provider, paymentRef);
    if (row === undefined || row.externalRef === null) {
      throw new AppError("payment.not_found", key);
    }
    await assertReversible(tx, { ...key, kind, amount });
    return { ...row, externalRef: row.externalRef };
  });
  const attempted = amount ?? decimal(found.amount);
  const outcome = await send(found.externalRef);
  if (outcome === "refused") {
    await withTransaction(db, (tx) => recordFailedRefund(tx, { ...key, amount: attempted }));
    return { ...key, state: found.state, amount: attempted, settledAt: null };
  }
  const row = await withTransaction(db, (tx) =>
    kind === "void" ? recordVoid(tx, key) : recordRefund(tx, { ...key, amount: attempted }),
  );
  return { ...key, state: row.state, amount: amount ?? decimal(row.amount), settledAt: null };
}
