import type { InvoiceIdentity, MergeInvoiceChoice, PartyBill } from "../api/client.js";

/** What merging `from` into `into` asks before it is sent. */
export interface MergeInvoiceQuestion {
  into: PartyBill;
  from: PartyBill;
  /** The receiving bill's full-invoice customer; null when it is simplified. */
  intoName: string | null;
  fromName: string;
}

function identityOf(bill: PartyBill): InvoiceIdentity | null {
  const recipient = bill.invoiceType === "F1" ? bill.recipient : null;
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

/** The question the server refuses a merge without (`bill.merge_invoice_choice_required`): the bill
 * merged away is set for a full invoice whose customer the receiving bill does not already name.
 * Null when it does not apply, or when either bill is not in `bills`. */
export function mergeInvoiceQuestion(
  bills: readonly PartyBill[],
  intoBillId: string,
  fromBillId: string,
): MergeInvoiceQuestion | null {
  const into = bills.find((bill) => bill.workingOrderId === intoBillId);
  const from = bills.find((bill) => bill.workingOrderId === fromBillId);
  if (into === undefined || from === undefined) return null;
  const fromIdentity = identityOf(from);
  if (fromIdentity === null || sameIdentity(fromIdentity, identityOf(into))) return null;
  return {
    into,
    from,
    intoName: identityOf(into) === null ? null : into.recipient!.legalName,
    fromName: from.recipient!.legalName,
  };
}

/** The answer to `question` keeping `keep`'s invoice, naming each bill's customer as it was read. */
export function mergeInvoiceChoice(
  question: MergeInvoiceQuestion,
  keep: "into" | "from",
): MergeInvoiceChoice {
  return { keep, into: identityOf(question.into), from: identityOf(question.from)! };
}
