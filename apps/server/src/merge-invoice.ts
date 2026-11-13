import "./errors.js";
import { eq, inArray } from "drizzle-orm";
import { workingOrders, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";

/** A full-invoice customer as the till names one: legal name and address are not compared. */
export interface InvoiceIdentity {
  taxId: string;
  identifierType: string | null;
  identifierCountryCode: string | null;
}

/** Which bill's invoice a merged bill, or the bill every dish moves to, keeps, and each bill's
 * customer as the till saw it. */
export interface MergeInvoiceChoice {
  keep: "into" | "from";
  /** Null: the receiving bill was simplified or new. */
  into: InvoiceIdentity | null;
  from: InvoiceIdentity;
}

const INVOICE_COLUMNS = {
  id: workingOrders.id,
  invoiceType: workingOrders.invoiceType,
  recipientTaxId: workingOrders.recipientTaxId,
  recipientLegalName: workingOrders.recipientLegalName,
  recipientAddress: workingOrders.recipientAddress,
  recipientCountryCode: workingOrders.recipientCountryCode,
  recipientIdentifierType: workingOrders.recipientIdentifierType,
  recipientIdentifierCountryCode: workingOrders.recipientIdentifierCountryCode,
  invoiceDelivery: workingOrders.invoiceDelivery,
  receiptLocale: workingOrders.receiptLocale,
};

type BillInvoice = {
  [K in keyof typeof INVOICE_COLUMNS]: (typeof workingOrders.$inferSelect)[K];
};

/** Both bills' invoices as the merge read them, and whether the merged-away bill's is kept. */
export interface MergeInvoices {
  into: BillInvoice;
  from: BillInvoice;
  keepFrom: boolean;
}

function invalid(): never {
  throw new AppError("management.request_invalid", { field: "invoiceChoice" });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") invalid();
  return value;
}

function requireIdentity(value: unknown): InvoiceIdentity {
  if (!isObject(value) || typeof value.taxId !== "string") invalid();
  return {
    taxId: value.taxId,
    identifierType: optionalText(value.identifierType),
    identifierCountryCode: optionalText(value.identifierCountryCode),
  };
}

/** Refuses a malformed `value` as `management.request_invalid`; undefined when none was sent. */
export function parseMergeInvoiceChoice(value: unknown): MergeInvoiceChoice | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value) || (value.keep !== "into" && value.keep !== "from")) invalid();
  const into = value.into === null ? null : requireIdentity(value.into);
  if (value.keep === "into" && into === null) invalid();
  return { keep: value.keep, into, from: requireIdentity(value.from) };
}

function identityOf(bill: BillInvoice): InvoiceIdentity | null {
  if (bill.invoiceType !== "F1" || bill.recipientTaxId === null) return null;
  return {
    taxId: bill.recipientTaxId,
    identifierType: bill.recipientIdentifierType,
    identifierCountryCode: bill.recipientIdentifierCountryCode,
  };
}

function sameIdentity(a: InvoiceIdentity | null, b: InvoiceIdentity | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.taxId === b.taxId &&
    a.identifierType === b.identifierType &&
    a.identifierCountryCode === b.identifierCountryCode
  );
}

async function readMergeInvoices(
  tx: Transaction,
  intoBillId: string,
  fromBillId: string,
): Promise<{ into: BillInvoice; from: BillInvoice }> {
  const rows = await tx
    .select(INVOICE_COLUMNS)
    .from(workingOrders)
    .where(inArray(workingOrders.id, [intoBillId, fromBillId]));
  return {
    into: rows.find((row) => row.id === intoBillId)!,
    from: rows.find((row) => row.id === fromBillId)!,
  };
}

/**
 * Refuses `bill.merge_invoice_choice_required` when merging `fromBillId` away, or moving every dish
 * off it, would change which customer is invoiced and `rawChoice` does not say which to keep, or
 * names either bill's customer other than as it stands now. A hand change of a bill's invoice moves
 * neither the party's revision nor the bill-edit state, so this comparison is the only check that
 * sees one.
 */
export async function checkMergeInvoice(
  tx: Transaction,
  intoBillId: string,
  fromBillId: string,
  rawChoice: unknown,
): Promise<MergeInvoices> {
  const choice = parseMergeInvoiceChoice(rawChoice);
  const bills = await readMergeInvoices(tx, intoBillId, fromBillId);
  const into = identityOf(bills.into);
  const from = identityOf(bills.from);
  const stale =
    choice === undefined
      ? from !== null && !sameIdentity(from, into)
      : !sameIdentity(choice.into, into) || !sameIdentity(choice.from, from);
  if (stale) {
    throw new AppError("bill.merge_invoice_choice_required", {
      workingOrderId: fromBillId,
      intoWorkingOrderId: intoBillId,
    });
  }
  return { ...bills, keepFrom: choice?.keep === "from" };
}

/**
 * Writes onto `intoBillId` what it keeps of the merged-away bill's invoice. Kept: its type,
 * customer and delivery, and its receipt language when it has one. Otherwise the receiving bill
 * takes only what it lacks: the receipt language, and the delivery when both name one customer.
 */
export async function carryMergeInvoice(
  tx: Transaction,
  intoBillId: string,
  { into, from, keepFrom }: MergeInvoices,
): Promise<void> {
  const language = into.receiptLocale ?? from.receiptLocale;
  const set: Partial<typeof workingOrders.$inferInsert> = keepFrom
    ? {
        invoiceType: from.invoiceType,
        recipientTaxId: from.recipientTaxId,
        recipientLegalName: from.recipientLegalName,
        recipientAddress: from.recipientAddress,
        recipientCountryCode: from.recipientCountryCode,
        recipientIdentifierType: from.recipientIdentifierType,
        recipientIdentifierCountryCode: from.recipientIdentifierCountryCode,
        invoiceDelivery: from.invoiceDelivery,
        receiptLocale: from.receiptLocale ?? into.receiptLocale,
      }
    : {
        ...(language === into.receiptLocale ? {} : { receiptLocale: language }),
        ...(into.invoiceDelivery === null &&
        from.invoiceDelivery !== null &&
        identityOf(into) !== null &&
        sameIdentity(identityOf(into), identityOf(from))
          ? { invoiceDelivery: from.invoiceDelivery }
          : {}),
      };
  if (Object.keys(set).length === 0) return;
  await tx.update(workingOrders).set(set).where(eq(workingOrders.id, intoBillId));
}
