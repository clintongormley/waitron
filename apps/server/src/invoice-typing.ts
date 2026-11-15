import { eq } from "drizzle-orm";
import { invoiceSeries, sales, type Transaction } from "@waitron/db";
import { formatInvoiceNumber } from "@waitron/core";
import { storedRecipientIdentifier } from "./invoice-selection.js";
import type { TillSaleResult } from "./till-sale.js";

export type TypedSale = Pick<
  typeof sales.$inferSelect,
  | "correctsSaleId"
  | "replacesOriginal"
  | "supplyDay"
  | "issuedAt"
  | "issuedOffsetMinutes"
  | "counterpartyTaxId"
  | "counterpartyLegalName"
  | "counterpartyCountryCode"
  | "counterpartyIdentifierType"
  | "counterpartyIdentifierCountryCode"
  | "counterpartyAddress"
>;

export type InvoiceTyping = Pick<
  TillSaleResult,
  "invoiceType" | "corrects" | "recipient" | "saleDay"
>;

function issueDay(issuedAt: string, offsetMinutes: number): string {
  return new Date(Date.parse(issuedAt) + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/**
 * The one place a stored sale is typed for printing: an ordinary sale is F1 when it names a
 * customer and F2 otherwise; a corrective is R4 when it names a customer (only a replacement of a
 * full invoice does) and R5 otherwise, and names the invoice it corrects.
 */
export async function readInvoiceTyping(tx: Transaction, sale: TypedSale): Promise<InvoiceTyping> {
  const recipient =
    sale.counterpartyTaxId !== null &&
    sale.counterpartyLegalName !== null &&
    sale.counterpartyCountryCode !== null &&
    sale.counterpartyAddress !== null
      ? {
          recipient: {
            taxId: sale.counterpartyTaxId,
            ...storedRecipientIdentifier(
              sale.counterpartyIdentifierType,
              sale.counterpartyIdentifierCountryCode,
            ),
            legalName: sale.counterpartyLegalName,
            countryCode: sale.counterpartyCountryCode,
            address: sale.counterpartyAddress,
          },
        }
      : {};
  const full = sale.counterpartyTaxId !== null;
  if (sale.correctsSaleId === null) return { invoiceType: full ? "F1" : "F2", ...recipient };
  const [corrected] = await tx
    .select({
      code: invoiceSeries.code,
      invoiceNumber: sales.invoiceNumber,
      issuedAt: sales.issuedAt,
      issuedOffsetMinutes: sales.issuedOffsetMinutes,
    })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(eq(sales.id, sale.correctsSaleId));
  return {
    invoiceType: full ? "R4" : "R5",
    corrects: {
      invoiceNumber: formatInvoiceNumber(corrected!.code, corrected!.invoiceNumber),
      issuedAt: new Date(corrected!.issuedAt).toISOString(),
      issuedOffsetMinutes: corrected!.issuedOffsetMinutes,
      ...(sale.replacesOriginal ? { inFull: true as const } : {}),
    },
    ...(sale.supplyDay !== null &&
    sale.supplyDay !== issueDay(sale.issuedAt, sale.issuedOffsetMinutes)
      ? { saleDay: sale.supplyDay }
      : {}),
    ...recipient,
  };
}
