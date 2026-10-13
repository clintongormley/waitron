import "./errors.js";
import { eq } from "drizzle-orm";
import { invoicePdfDownloads, invoiceSeries, sales, type Transaction } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import { readInvoiceDocument } from "./invoice-document.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";
import type { TillConfig } from "./till-config.js";

/** The bill's full invoice as a duplicate, with the download recorded; writes no delivery row. */
export async function readInvoiceForDownload(
  tx: Transaction,
  deps: { backend: FiscalBackend; till: TillConfig },
  billId: string,
  personId: string,
): Promise<{ document: ReceiptDocumentInput; fileName: string }> {
  const [sale] = await tx
    .select({ id: sales.id, code: invoiceSeries.code, number: sales.invoiceNumber })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(eq(sales.workingOrderId, billId));
  if (sale === undefined) throw new AppError("working_order.not_found", { workingOrderId: billId });
  const document = await readInvoiceDocument(deps.backend, tx, deps.till, sale.id);
  await tx.insert(invoicePdfDownloads).values({ saleId: sale.id, personId });
  return {
    document: { ...document, duplicate: true },
    // A series code may hold `/`; anything outside this set is replaced so the name stays one
    // path segment and needs no escaping inside the quoted header value.
    fileName: `${sale.code.replace(/[^A-Za-z0-9_.-]/g, "_")}-${sale.number}.pdf`,
  };
}
