import { eq, inArray, sql } from "drizzle-orm";
import { formatInvoiceNumber } from "@waitron/core";
import { invoiceSeries, sales } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { centsToDecimal } from "@waitron/shared";
import { normaliseInvoiceTaxId } from "./invoice-customer-tax-id.js";
import { SALE_LOOKUP_CHUNK } from "./personal-data-actions.js";

export interface InvoiceCustomerSale {
  saleId: string;
  invoice: string;
  issuedAt: string;
  name: string;
  taxId: string;
  countryCode: string;
  address: string;
  total: string;
}

/** Decision 6's search: one statement over the sales naming a customer, filtered by
 * `normaliseInvoiceTaxId`, then their columns by key. Call it inside a write-lock turn. */
export async function findInvoiceCustomerSales(
  tx: Transaction,
  taxId: string,
  options?: { chunk?: number },
): Promise<InvoiceCustomerSale[]> {
  const chunk = options?.chunk ?? SALE_LOOKUP_CHUNK;
  const wanted = normaliseInvoiceTaxId(taxId);
  // No ORDER BY: ordering by issued_at walks the issue-time index and fetches every row by
  // position, slower than the plain scan (plan decision 6).
  const named = tx.all<{ id: string; counterparty_tax_id: string }>(
    sql`select id, counterparty_tax_id from sales where counterparty_tax_id is not null`,
  );
  const matched = named
    .filter((row) => normaliseInvoiceTaxId(row.counterparty_tax_id) === wanted)
    .map((row) => row.id);
  const found: InvoiceCustomerSale[] = [];
  for (let start = 0; start < matched.length; start += chunk) {
    const rows = await tx
      .select({
        id: sales.id,
        code: invoiceSeries.code,
        number: sales.invoiceNumber,
        issuedAt: sales.issuedAt,
        name: sales.counterpartyLegalName,
        taxId: sales.counterpartyTaxId,
        countryCode: sales.counterpartyCountryCode,
        address: sales.counterpartyAddress,
        total: sales.total,
      })
      .from(sales)
      .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
      .where(inArray(sales.id, matched.slice(start, start + chunk)));
    for (const row of rows)
      found.push({
        saleId: row.id,
        invoice: formatInvoiceNumber(row.code, row.number),
        issuedAt: row.issuedAt,
        name: row.name ?? "",
        taxId: row.taxId ?? "",
        countryCode: row.countryCode ?? "",
        address: row.address ?? "",
        total: centsToDecimal(row.total),
      });
  }
  return found.sort(
    (a, b) => a.issuedAt.localeCompare(b.issuedAt) || a.saleId.localeCompare(b.saleId),
  );
}
