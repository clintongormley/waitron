import { readTaxpayer, type Transaction } from "@waitron/db";
import { buildReceiptDocument, type ReceiptDocumentInput } from "./receipt-document.js";
import { readPrintedGuests } from "./receipt-guests.js";
import type { TillSaleResult } from "./till-sale.js";

export async function tillReceiptPreview(
  tx: Transaction,
  saleId: string,
  ticket: TillSaleResult,
  practiceMode: boolean,
): Promise<TillSaleResult> {
  let issuer = ticket.issuer;
  if (issuer === undefined) {
    const taxpayer = await readTaxpayer(tx);
    if (taxpayer === null) return ticket;
    issuer = { venueName: taxpayer.legalName, nif: taxpayer.taxId };
  }
  const guests = await readPrintedGuests(tx, saleId);
  const input: ReceiptDocumentInput = {
    result: ticket,
    issuer,
    paperWidth: "80mm",
    receiptHeader: ticket.receiptHeader,
    receipt: ticket.receiptTrim,
    venueAddress: ticket.receiptSettings.printAddress ? ticket.venueAddress : [],
    venueAddressLine: ticket.venueAddressLine,
    invoiceLocale: ticket.locale,
    namesLocale: ticket.namesLocale,
    simulated: practiceMode,
    simulatedCardPayment: ticket.simulatedCardPayment,
    guests,
  };
  try {
    return { ...ticket, receiptPreview: buildReceiptDocument(input).elements };
  } catch {
    console.warn("receipt.optional_read_failed", {
      operation: "tillReceiptPreview",
      code: "receipt.read_failed",
    });
    return ticket;
  }
}
