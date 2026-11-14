import type { ModuleHandoverContribution } from "@waitron/module";
import type { BackupQuery, BackupValue } from "@waitron/store";
import { IN_PROGRESS_PAYMENT_STATES } from "./provider.js";

const OPEN_PAYMENT_STATES = IN_PROGRESS_PAYMENT_STATES;
export type OpenPaymentState = (typeof OPEN_PAYMENT_STATES)[number];

export type OpenPayments = {
  readonly payments: readonly {
    readonly paymentId: string;
    readonly provider: string;
    readonly reference: string;
    readonly state: OpenPaymentState;
  }[];
  readonly refunds: readonly {
    readonly refundId: string;
    readonly provider: string | null;
    readonly providerPaymentRef: string | null;
  }[];
  readonly billRefunds: readonly {
    readonly refundId: string;
    readonly billPaymentId: string;
    readonly provider: string | null;
    readonly paymentRef: string | null;
    /** What the provider is sent and looked up by: the processor's own reference, else ours. */
    readonly processorRef: string | null;
    /** Null when the refund was never sent: the follow-up fails it without asking. */
    readonly sentAt: string | null;
  }[];
};

function nullableText(value: BackupValue | undefined): string | null {
  return value === null ? null : String(value);
}

/**
 * Each ordered by id, reading only: payments in `attempting` or `initiated`;
 * `tender_refunds` that are connected card and pending; every pending `bill_payment_refunds` row (only a
 * card refund is ever saved pending), with its bill payment's provider row when there is one.
 */
export async function summariseOpenPayments(query: BackupQuery): Promise<OpenPayments> {
  const payments: OpenPayments["payments"][number][] = [];
  for await (const row of query.rows(
    `select id, provider, payment_ref, state from payments
     where state in (${OPEN_PAYMENT_STATES.map(() => "?").join(", ")}) order by id`,
    [...OPEN_PAYMENT_STATES],
  ))
    payments.push({
      paymentId: String(row.id),
      provider: String(row.provider),
      reference: String(row.payment_ref),
      state: String(row.state) as OpenPaymentState,
    });

  // Only connected refunds are recovered on the receiving box.
  const refunds: OpenPayments["refunds"][number][] = [];
  for await (const row of query.rows(
    `select id, provider, provider_payment_ref from tender_refunds
     where method = 'card' and state = 'pending' and manual = false order by id`,
  ))
    refunds.push({
      refundId: String(row.id),
      provider: nullableText(row.provider),
      providerPaymentRef: nullableText(row.provider_payment_ref),
    });

  const billRefunds: OpenPayments["billRefunds"][number][] = [];
  for await (const row of query.rows(
    `select r.id, r.bill_payment_id, r.sent_at, p.provider, p.payment_ref, p.external_ref
     from bill_payment_refunds r left join payments p on p.bill_payment_id = r.bill_payment_id
     where r.state = 'pending' order by r.id`,
  ))
    billRefunds.push({
      refundId: String(row.id),
      billPaymentId: String(row.bill_payment_id),
      provider: nullableText(row.provider),
      paymentRef: nullableText(row.payment_ref),
      processorRef: nullableText(row.external_ref) ?? nullableText(row.payment_ref),
      sentAt: nullableText(row.sent_at),
    });

  return { payments, refunds, billRefunds };
}

export const PAYMENTS_HANDOVER: ModuleHandoverContribution = {
  summarise: summariseOpenPayments,
};
