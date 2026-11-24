import { eq } from "drizzle-orm";
import { invoiceSeries, sales, type Transaction } from "@waitron/db";
import { formatInvoiceNumber } from "@waitron/core";
import { localCalendarDate } from "@waitron/shared";
import { storedRecipientIdentifier, type InvoiceRecipient } from "./invoice-selection.js";

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

export interface InvoiceTyping {
  invoiceType?: "F1" | "F2" | "R4" | "R5";
  /** On a corrective invoice (R4, R5), the invoice it corrects; `inFull` when it replaces it whole. */
  corrects?: {
    invoiceNumber: string;
    issuedAt: string;
    issuedOffsetMinutes?: number;
    inFull?: true;
  };
  /** The real day (`YYYY-MM-DD`) of the sale, when it is not its issue day: an F1/F2 issued on a later day, or a replacement. */
  saleDay?: string;
  recipient?: InvoiceRecipient;
}

/** Whether a document of this type prints the full-invoice layout: an F1, or an R4 replacement of
 * one. */
export function printsAsFullInvoice(invoiceType: InvoiceTyping["invoiceType"]): boolean {
  return invoiceType === "F1" || invoiceType === "R4";
}

function storedRecipient(sale: TypedSale): Pick<InvoiceTyping, "recipient"> {
  const { counterpartyTaxId: taxId, counterpartyLegalName: legalName } = sale;
  const { counterpartyCountryCode: countryCode, counterpartyAddress: address } = sale;
  if (taxId === null) return {};
  if (legalName === null || countryCode === null || address === null) {
    throw new Error("A sale names a customer's tax number without their name, country or address");
  }
  return {
    recipient: {
      taxId,
      ...storedRecipientIdentifier(
        sale.counterpartyIdentifierType,
        sale.counterpartyIdentifierCountryCode,
      ),
      legalName,
      countryCode,
      address,
    },
  };
}

function saleDayOf(sale: TypedSale): Pick<InvoiceTyping, "saleDay"> {
  return sale.supplyDay !== null &&
    sale.supplyDay !== localCalendarDate(new Date(sale.issuedAt), sale.issuedOffsetMinutes)
    ? { saleDay: sale.supplyDay }
    : {};
}

/**
 * An ordinary sale is F1 when it names a customer and F2 otherwise; a corrective is R4 when it
 * names a customer (only a replacement of a full invoice does) and R5 otherwise, and names the
 * invoice it corrects.
 */
export async function readInvoiceTyping(tx: Transaction, sale: TypedSale): Promise<InvoiceTyping> {
  const recipient = storedRecipient(sale);
  const full = sale.counterpartyTaxId !== null;
  if (sale.correctsSaleId === null) {
    return {
      invoiceType: full ? "F1" : "F2",
      ...saleDayOf(sale),
      ...recipient,
    };
  }
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
    ...saleDayOf(sale),
    ...recipient,
  };
}
