import { AppError, decimal } from "@waitron/shared";
import type { Decimal, TenantId } from "@waitron/shared";
import { withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { PaymentResult } from "@waitron/payments";
import {
  assertReversible,
  findPaymentByRef,
  recordFailedRefund,
  recordRefund,
  recordVoid,
} from "@waitron/payments";
import type { SumUpClient } from "./client.js";
import { SUMUP_PROVIDER } from "./client.js";

/**
 * void / refund / partialRefund via SumUp's refund endpoint (there is no separate void: spec §5,
 * confirmed against SumUp's OpenAPI file 2026-09-10). T1: find + read-only reversibility pre-check
 * inside `withTenant`, refusing a payment of another tenant with the same `payment.not_found` as an
 * absent one; network: the refund, OUTSIDE every transaction; T2: `recordVoid`/`recordRefund`, or
 * `recordFailedRefund` when SumUp refused (the row's state is untouched). The same T1/T2 shape as
 * `reverseViaStripe`; not shared with it because one vendor's package must not import another's —
 * lifting both into a neutral `@waitron/payments` primitive is recorded in the backlog.
 */
export async function reverseViaSumUp(
  db: Database,
  client: Pick<SumUpClient, "refund">,
  ref: string,
  kind: "void" | "refund",
  amount: Decimal | undefined,
  { tenantId }: { tenantId: TenantId; nodeId: string },
): Promise<PaymentResult> {
  const inTransaction = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenant(db, tenantId, fn);
  const found = await inTransaction(async (tx) => {
    const f = await findPaymentByRef(tx, SUMUP_PROVIDER, ref);
    if (
      f === undefined ||
      f.externalRef === null ||
      f.tenantId.toLowerCase() !== tenantId.toLowerCase()
    ) {
      throw new AppError("payment.not_found", { provider: SUMUP_PROVIDER, paymentRef: ref });
    }
    await assertReversible(tx, {
      tenantId: f.tenantId,
      provider: SUMUP_PROVIDER,
      paymentRef: ref,
      kind,
      amount,
    });
    return { ...f, externalRef: f.externalRef };
  });
  const key = { tenantId: found.tenantId, provider: SUMUP_PROVIDER, paymentRef: ref };
  const attempted = amount ?? decimal(found.amount);

  const outcome = await client.refund({
    transactionId: found.externalRef,
    ...(amount ? { amount } : {}),
  });
  if (outcome.status === "refused") {
    await inTransaction((tx) => recordFailedRefund(tx, { ...key, amount: attempted }));
    return {
      provider: SUMUP_PROVIDER,
      paymentRef: ref,
      state: found.state,
      amount: attempted,
      settledAt: null,
    };
  }
  const row = await inTransaction((tx) =>
    kind === "void" ? recordVoid(tx, key) : recordRefund(tx, { ...key, amount: attempted }),
  );
  return {
    provider: SUMUP_PROVIDER,
    paymentRef: ref,
    state: row.state,
    amount: amount ?? decimal(row.amount),
    settledAt: null,
  };
}
