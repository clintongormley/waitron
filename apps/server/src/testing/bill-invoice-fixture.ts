import { eq } from "drizzle-orm";
import { workingOrders } from "@waitron/db";
import type { RecipientIdentifierType } from "@waitron/country-packs";
import { readBillEditState } from "../bill-editing.js";
import { setOrderInvoiceChoice } from "../working-order.js";
import { OPERATOR, billRow, inTx, type PartyVenue } from "./party-venue.js";

export const ACME = {
  taxId: "12345678Z",
  legalName: "Acme Travel SL",
  address: "2 Main Street, 08001 Barcelona, Barcelona",
  countryCode: "ES",
};
export const BAR_SOL = {
  taxId: "B12345674",
  legalName: "Bar Sol SL",
  address: "5 Sea Road, 28013 Madrid, Madrid",
  countryCode: "ES",
};

/** Sets the bill for a full invoice to `recipient`, as another till's invoice choice does. */
export async function fullInvoice(
  v: PartyVenue,
  billId: string,
  recipient: typeof ACME & {
    identifierType?: RecipientIdentifierType;
    identifierCountryCode?: string;
  },
  delivery?: { medium: "receipt" },
): Promise<void> {
  await setOrderInvoiceChoice(v.db, v.backend, v.cfg, billId, {
    revision: (await billRow(v, billId)).revision,
    invoiceType: "F1",
    recipient,
    ...(delivery === undefined ? {} : { delivery }),
    operatorId: OPERATOR,
    expectedEdit: await inTx(v, (tx) => readBillEditState(tx, billId)),
  });
}

export async function setReceiptLanguage(
  v: PartyVenue,
  billId: string,
  language: string,
): Promise<void> {
  await inTx(v, (tx) =>
    tx.update(workingOrders).set({ receiptLocale: language }).where(eq(workingOrders.id, billId)),
  );
}

/** The bill's invoice: its type, recipient, delivery and receipt language. */
export async function invoiceOf(v: PartyVenue, billId: string) {
  const row = await billRow(v, billId);
  return {
    invoiceType: row.invoiceType,
    taxId: row.recipientTaxId,
    legalName: row.recipientLegalName,
    address: row.recipientAddress,
    countryCode: row.recipientCountryCode,
    identifierType: row.recipientIdentifierType,
    identifierCountryCode: row.recipientIdentifierCountryCode,
    delivery: row.invoiceDelivery,
    language: row.receiptLocale,
  };
}

export const SIMPLIFIED = {
  invoiceType: "F2",
  taxId: null,
  legalName: null,
  address: null,
  countryCode: null,
  identifierType: null,
  identifierCountryCode: null,
};

export function invoiceTo(recipient: typeof ACME) {
  return { invoiceType: "F1", ...recipient, identifierType: null, identifierCountryCode: null };
}
