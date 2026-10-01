import { inArray, sql } from "drizzle-orm";
import { sales } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  addDecimal,
  centsToDecimal,
  rawCentsToDecimal,
  saleId as brandSaleId,
} from "@waitron/shared";
import type { Decimal, SaleId } from "@waitron/shared";

/**
 * The signed sum, in whole cents, of the corrective invoices of the `sales` row a query reads.
 * `${sales}.id` (not `${sales.id}`) renders the column table-qualified so the `sales c` subquery
 * cannot capture a bare `"id"`.
 */
export const correctionsCents = sql`coalesce((select sum(c.total) from sales c where c.corrects_sale_id = ${sales}.id), 0)`;

/**
 * The sale each named working order has already issued, with what it owes: `total + corrections`,
 * the same `due` `settleSale` re-derives, so a card charged `amountDue + tip` settles the sale
 * exactly. An order with no sale is absent.
 */
export async function readIssuedSales(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<Map<string, { saleId: SaleId; amountDue: Decimal }>> {
  if (workingOrderIds.length === 0) return new Map();
  const rows = await tx
    .select({
      id: sales.id,
      workingOrderId: sales.workingOrderId,
      total: sales.total,
      // Cast to text for `rawCentsToDecimal`, which refuses a number.
      corrections: sql<string>`cast(${correctionsCents} as text)`,
    })
    .from(sales)
    .where(inArray(sales.workingOrderId, [...workingOrderIds]));
  return new Map(
    rows.map((row) => [
      row.workingOrderId!,
      {
        saleId: brandSaleId(row.id),
        amountDue: addDecimal(centsToDecimal(row.total), rawCentsToDecimal(row.corrections)),
      },
    ]),
  );
}
