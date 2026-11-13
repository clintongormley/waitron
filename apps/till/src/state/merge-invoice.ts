import { countryNameFor } from "@waitron/country-packs";
import type { InvoiceIdentity, MergeInvoiceChoice, PartyBill } from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";

/** What merging `from` into `into`, or moving every dish of `from` to it, asks before it is sent.
 * `into` is null for a move to a new bill. */
export interface MergeInvoiceQuestion {
  into: PartyBill | null;
  from: PartyBill;
}

function customerOf(bill: PartyBill): string {
  return `${bill.recipient!.legalName} · ${bill.recipient!.taxId}`;
}

function identifierOf(bill: PartyBill): string {
  const { identifierType, identifierCountryCode } = bill.recipient!;
  const type = t(`invoice.identifier.${identifierType ?? "tax-number"}`);
  return identifierCountryCode === undefined
    ? type
    : `${type} · ${countryNameFor(identifierCountryCode, currentLocale())}`;
}

function identityOf(bill: PartyBill | null): InvoiceIdentity | null {
  const recipient = bill?.invoiceType === "F1" ? bill.recipient : null;
  if (recipient === null) return null;
  return {
    taxId: recipient.taxId,
    ...(recipient.identifierType === undefined ? {} : { identifierType: recipient.identifierType }),
    ...(recipient.identifierCountryCode === undefined
      ? {}
      : { identifierCountryCode: recipient.identifierCountryCode }),
  };
}

function sameIdentity(a: InvoiceIdentity | null, b: InvoiceIdentity | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.taxId === b.taxId &&
    (a.identifierType ?? null) === (b.identifierType ?? null) &&
    (a.identifierCountryCode ?? null) === (b.identifierCountryCode ?? null)
  );
}

/** The question the server refuses a merge, or a move of every dish, without
 * (`bill.merge_invoice_choice_required`): the bill merged away or emptied is set for a full invoice whose customer the receiving bill does not already name. A
 * null `intoBillId` is a new bill, which names no customer. Null when it does not apply, or when
 * either bill is not in `bills`. */
export function mergeInvoiceQuestion(
  bills: readonly PartyBill[],
  intoBillId: string | null,
  fromBillId: string,
): MergeInvoiceQuestion | null {
  const into =
    intoBillId === null ? null : bills.find((bill) => bill.workingOrderId === intoBillId);
  const from = bills.find((bill) => bill.workingOrderId === fromBillId);
  if (into === undefined || from === undefined) return null;
  const fromIdentity = identityOf(from);
  if (fromIdentity === null || sameIdentity(fromIdentity, identityOf(into))) return null;
  return { into, from };
}

/** Each bill's customer as the question names it, in the till's current language: legal name and
 * tax number, plus identifier type and issuing country when those alone tell the two apart. The
 * receiving bill's is null when it is simplified or new. */
export function mergeInvoiceNames(question: MergeInvoiceQuestion): {
  intoName: string | null;
  fromName: string;
} {
  const { into, from } = question;
  const fromName = customerOf(from);
  if (into === null || identityOf(into) === null) return { intoName: null, fromName };
  const intoName = customerOf(into);
  if (intoName !== fromName) return { intoName, fromName };
  return {
    intoName: `${intoName} · ${identifierOf(into)}`,
    fromName: `${fromName} · ${identifierOf(from)}`,
  };
}

/** The answer to `question` keeping `keep`'s invoice, naming each bill's customer as it was read. */
export function mergeInvoiceChoice(
  question: MergeInvoiceQuestion,
  keep: "into" | "from",
): MergeInvoiceChoice {
  return { keep, into: identityOf(question.into), from: identityOf(question.from)! };
}
