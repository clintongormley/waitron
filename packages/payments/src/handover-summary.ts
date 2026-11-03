import type { ModuleHandoverContribution } from "@waitron/module";
import type { BackupQuery, BackupValue } from "@waitron/store";

export type OpenPaymentState = "attempting" | "initiated" | "accepted_offline";

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
};

function nullableText(value: BackupValue | undefined): string | null {
  return value === null ? null : String(value);
}

/** Every payment and card refund whose outcome is still open, each ordered by id. Reads only. */
export async function summariseOpenPayments(query: BackupQuery): Promise<OpenPayments> {
  const payments: OpenPayments["payments"][number][] = [];
  for await (const row of query.rows(
    `select id, provider, payment_ref, state from payments
     where state in ('attempting', 'initiated', 'accepted_offline') order by id`,
  ))
    payments.push({
      paymentId: String(row.id),
      provider: String(row.provider),
      reference: String(row.payment_ref),
      state: String(row.state) as OpenPaymentState,
    });

  const refunds: OpenPayments["refunds"][number][] = [];
  for await (const row of query.rows(
    `select id, provider, provider_payment_ref from tender_refunds
     where method = 'card' and state = 'pending' order by id`,
  ))
    refunds.push({
      refundId: String(row.id),
      provider: nullableText(row.provider),
      providerPaymentRef: nullableText(row.provider_payment_ref),
    });

  return { payments, refunds };
}

export const PAYMENTS_HANDOVER: ModuleHandoverContribution = {
  summarise: summariseOpenPayments,
};
