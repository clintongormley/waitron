import { readTaxpayer, type Transaction } from "@waitron/db";
import { buildReceiptDocument } from "./receipt-document.js";
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
  const { elements } = buildReceiptDocument({
    result: ticket,
    issuer,
    paperWidth: "80mm",
    receiptHeader: ticket.receiptHeader,
    receipt: ticket.receiptTrim,
    venueAddress: ticket.receiptSettings.printAddress ? ticket.venueAddress : [],
    invoiceLocale: ticket.locale,
    namesLocale: ticket.namesLocale,
    simulated: practiceMode,
    simulatedCardPayment: ticket.simulatedCardPayment,
    guests,
  });
  return { ...ticket, receiptPreview: elements };
}
