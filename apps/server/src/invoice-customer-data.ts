import { setImmediate as nextTurn } from "node:timers/promises";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { formatInvoiceNumber } from "@waitron/core";
import { invoiceDeliveries, invoiceSeries, sales } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import { jsonFile, type PersonalDataFile } from "@waitron/module";
import { centsToDecimal, saleId as brandSaleId } from "@waitron/shared";
import { readInvoiceDocument } from "./invoice-document.js";
import { normaliseInvoiceTaxId } from "./invoice-customer-tax-id.js";
import { renderInvoicePdf } from "./invoice-pdf.js";
import type { Logger } from "./logger.js";
import { SALE_LOOKUP_CHUNK } from "./personal-data-actions.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";
import type { TillConfig } from "./till-config.js";

export const INVOICE_CUSTOMER_FILE = "invoices.json";

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

export interface InvoiceCustomerFilesDeps {
  db: Database;
  backend: FiscalBackend;
  till: TillConfig;
  log: Logger;
  /** Default `renderInvoicePdf`; a test passes a stub. */
  render?: (document: ReceiptDocumentInput) => Promise<Uint8Array>;
  /** Default `readInvoiceDocument`; a test passes one that throws. */
  readDocument?: typeof readInvoiceDocument;
}

/** `formatInvoiceNumber`'s inverse: a code may hold `/`, the number never does. */
function splitInvoice(invoice: string): [code: string, number: string] {
  const at = invoice.lastIndexOf("/");
  return [invoice.slice(0, at), invoice.slice(at + 1)];
}

interface InvoiceRead {
  sale: InvoiceCustomerSale;
  pdf: string;
  document: ReceiptDocumentInput;
  taxRecord: boolean;
  emails: { to: string; requestedAt: string; status: string; sentAt: string | null }[];
}

/** Decision 6's invoice turns, then the PDFs outside any turn, with `nextTurn()` after each.
 * Throws a plain `Error` (cause attached) when any invoice cannot be made, after logging
 * `invoice_customer.pdf_failed` with its sale id. */
export async function buildInvoiceCustomerFiles(
  deps: InvoiceCustomerFilesDeps,
  taxId: string,
  sales: readonly InvoiceCustomerSale[],
): Promise<{ files: PersonalDataFile[]; anyTaxRecord: boolean; anyEmail: boolean }> {
  const readDocument = deps.readDocument ?? readInvoiceDocument;
  const render = deps.render ?? renderInvoicePdf;
  // A plain Error, so the boundary answers an opaque 500 rather than the reader's own AppError;
  // a full disk stays findable in the cause chain.
  async function made<T>(saleId: string, step: () => Promise<T>): Promise<T> {
    try {
      return await step();
    } catch (cause) {
      deps.log("error", "invoice_customer.pdf_failed", { saleId });
      throw new Error("an invoice customer's invoice could not be made", { cause });
    }
  }
  // Lock turns read through the database itself, not `withTransaction`: nothing is written, and
  // its closing change-log drain is a write a full disk refuses.
  const tx = deps.db;
  const read: InvoiceRead[] = [];
  for (const sale of sales) {
    read.push(
      await made(sale.saleId, () =>
        deps.db.withWriteLock(async () => {
          const document = await readDocument(deps.backend, tx, deps.till, sale.saleId);
          // Decision 11: a filed record is what the box sends to the tax authority. A regime
          // that kept records without sending them would make this flag, and the README's line
          // it gates, wrong.
          const taxRecord =
            (await deps.backend.filedReceiptFor(tx, brandSaleId(sale.saleId))) !== undefined;
          const deliveries = await tx
            .select({
              recipient: invoiceDeliveries.recipient,
              createdAt: invoiceDeliveries.createdAt,
              status: invoiceDeliveries.status,
              completedAt: invoiceDeliveries.completedAt,
            })
            .from(invoiceDeliveries)
            .where(
              and(eq(invoiceDeliveries.saleId, sale.saleId), eq(invoiceDeliveries.medium, "email")),
            )
            .orderBy(asc(invoiceDeliveries.createdAt), asc(invoiceDeliveries.id));
          const [code, number] = splitInvoice(sale.invoice);
          return {
            sale,
            pdf: `invoices/${code.replace(/[^A-Za-z0-9_.-]/g, "_")}-${number}.pdf`,
            document: { ...document, duplicate: true },
            taxRecord,
            emails: deliveries.map((row) => ({
              to: row.recipient!,
              requestedAt: row.createdAt,
              status: row.status,
              sentAt: row.status === "sent" ? row.completedAt : null,
            })),
          };
        }),
      ),
    );
    await nextTurn();
  }
  const pdfs: PersonalDataFile[] = [];
  for (const invoice of read) {
    pdfs.push({
      name: invoice.pdf,
      content: await made(invoice.sale.saleId, () => render(invoice.document)),
    });
    await nextTurn();
  }
  const file = {
    taxId: normaliseInvoiceTaxId(taxId),
    invoices: read.map(({ sale, pdf, taxRecord, emails }) => ({
      invoice: sale.invoice,
      issuedAt: sale.issuedAt,
      name: sale.name,
      taxId: sale.taxId,
      countryCode: sale.countryCode,
      address: sale.address,
      total: sale.total,
      pdf,
      taxRecord,
      emails,
    })),
  };
  return {
    files: [jsonFile(INVOICE_CUSTOMER_FILE, file), ...pdfs],
    anyTaxRecord: read.some((invoice) => invoice.taxRecord),
    anyEmail: read.some((invoice) => invoice.emails.length > 0),
  };
}
