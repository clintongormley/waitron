import "./errors.js";
import { eq } from "drizzle-orm";
import { sales, workingOrders, type StagedInvoiceDelivery, type Transaction } from "@waitron/db";
import { reserveInvoiceDelivery } from "./invoice-delivery.js";
import {
  resolveInvoiceEmailContact,
  type InvoiceEmailContactSource,
} from "./invoice-email-contact.js";
import { optionalDocument } from "./optional-document.js";
import { readInvoicePrinter } from "./page-printers.js";
import { AppError, isValidEmail, locationId } from "@waitron/shared";

export type InvoiceChoiceDeliveryContext = {
  personId: string;
  emailAvailable: boolean;
};

function invalid(field: string): never {
  throw new AppError("management.request_invalid", { field });
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function checkedInvoiceChoiceDelivery(
  tx: Transaction,
  input: {
    delivery: unknown;
    invoiceType: "F1" | "F2";
    locationId: string;
    source: InvoiceEmailContactSource;
    context: InvoiceChoiceDeliveryContext | undefined;
  },
): Promise<StagedInvoiceDelivery | null> {
  const delivery = input.delivery;
  if (delivery === undefined) return null;
  if (!object(delivery)) invalid("delivery");
  if (delivery.medium === "receipt") return { medium: "receipt" };
  if (delivery.medium !== "email" && delivery.medium !== "a4") invalid("delivery.medium");
  if (input.invoiceType !== "F1") invalid("delivery.medium");
  if (delivery.medium === "a4") {
    if (typeof delivery.pagePrinterId !== "string") invalid("delivery.pagePrinterId");
    const printer = await readInvoicePrinter(tx, input.locationId);
    if (printer?.id !== delivery.pagePrinterId) {
      throw new AppError("invoice_delivery.printer_invalid", {});
    }
    if (input.context === undefined) invalid("personId");
    return { medium: "a4", pagePrinterId: printer.id, personId: input.context.personId };
  }
  if (typeof delivery.recipient !== "string" || !isValidEmail(delivery.recipient)) {
    invalid("delivery.recipient");
  }
  if (input.context?.emailAvailable !== true) {
    throw new AppError("invoice_delivery.email_unavailable", {});
  }
  const contact = await resolveInvoiceEmailContact(
    tx,
    { locationId: locationId(input.locationId) },
    input.source,
  );
  if (contact === null) throw new AppError("invoice_delivery.email_unavailable", {});
  return {
    medium: "email",
    recipient: delivery.recipient.trim(),
    personId: input.context.personId,
  };
}

/** False means no non-paper choice, true means reserved, undefined means its optional attempt failed. */
export async function reserveStagedInvoiceDelivery(
  tx: Transaction,
  saleId: string,
): Promise<boolean | undefined> {
  return optionalDocument(tx, "reserveStagedInvoiceDelivery", saleId, async () => {
    const [sale] = await tx
      .select({
        recipient: sales.counterpartyTaxId,
        personId: sales.operatorId,
        delivery: workingOrders.invoiceDelivery,
      })
      .from(sales)
      .leftJoin(workingOrders, eq(workingOrders.id, sales.workingOrderId))
      .where(eq(sales.id, saleId));
    const delivery = sale?.delivery;
    if (sale?.recipient == null || delivery == null || delivery.medium === "receipt") return false;
    const personId = sale.personId ?? delivery.personId ?? null;
    if (personId === null) invalid("operatorId");
    // A destination accepted with the draft may be disabled after the card was captured.
    await reserveInvoiceDelivery(
      tx,
      saleId,
      {
        ...delivery,
        requestKey: `issuance:${saleId}`,
        personId,
      },
      { allowInactivePagePrinter: true },
    );
    return true;
  });
}
