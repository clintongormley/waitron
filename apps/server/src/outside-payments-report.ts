import { inArray, sql, type SQL } from "drizzle-orm";
import { tableExists, type Transaction } from "@waitron/db";
import { formatInvoiceNumber } from "@waitron/core";
import { rawCentsToDecimal, type Decimal } from "@waitron/shared";
import type { PaymentState } from "@waitron/payments";

export interface OutsidePayment {
  id: string;
  workingOrderId: string;
  orderNumber: number;
  saleId: string | null;
  invoiceNumber: string | null;
  nodeId: string | null;
  settledAt: string;
  amount: Decimal;
  externalProvider: "connected_account" | "other" | null;
  externalMachine: string | null;
  externalRef: string | null;
  state: PaymentState;
  refunded: Decimal;
}

export async function listOutsidePayments(
  tx: Transaction,
  window: (column: SQL) => SQL,
  nodeIds?: readonly string[],
): Promise<OutsidePayment[]> {
  if (!(await tableExists(tx, "payments"))) return [];
  const { rows } = await tx.execute<
    Omit<OutsidePayment, "invoiceNumber" | "amount" | "refunded"> & {
      amount: string;
      refunded: string;
      code: string | null;
      number: number | null;
    }
  >(sql`
    select p.id, p.working_order_id as workingOrderId, wo.order_number as orderNumber, p.sale_id as saleId,
      p.node_id as nodeId, p.settled_at as settledAt, cast(p.amount as text) as amount,
      p.external_provider as externalProvider, p.external_machine as externalMachine,
      p.external_ref as externalRef, p.state, s.invoice_number as number, series.code,
      cast((select coalesce(sum(r.amount), 0) from payment_refunds r
        where r.payment_id = p.id and r.state = 'succeeded') as text) as refunded
    from payments p
    join working_orders wo on wo.id = p.working_order_id
    left join sales s on s.id = p.sale_id
    left join invoice_series series on series.id = s.series_id
    where p.provider = 'manual' and ${window(sql`p.settled_at`)}
      ${nodeIds === undefined ? sql`` : sql`and ${inArray(sql`p.node_id`, nodeIds)}`}
    order by p.settled_at, p.id
  `);
  return rows.map(({ code, number, amount, refunded, ...row }) => ({
    ...row,
    invoiceNumber: code === null || number === null ? null : formatInvoiceNumber(code, number),
    amount: rawCentsToDecimal(amount),
    refunded: rawCentsToDecimal(refunded),
  }));
}
