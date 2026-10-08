import "./errors.js";
import { and, eq } from "drizzle-orm";
import {
  pagePrinters,
  locations,
  sales,
  workingOrders,
  type StagedInvoiceDelivery,
  type Transaction,
} from "@waitron/db";
import { reserveInvoiceDelivery } from "./invoice-delivery.js";
import { isValidEmail } from "@waitron/identity";
import { getReceipt } from "@waitron/layouts";
import { AppError } from "@waitron/shared";

export type InvoiceChoiceDeliveryContext = {
  personId: string;
  emailAvailable: boolean;
  now?: Date;
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
    const [printer] = await tx
      .select({ id: pagePrinters.id })
      .from(pagePrinters)
      .where(
        and(
          eq(pagePrinters.id, delivery.pagePrinterId),
          eq(pagePrinters.locationId, input.locationId),
          eq(pagePrinters.active, true),
        ),
      );
    if (printer === undefined) throw new AppError("invoice_delivery.printer_invalid", {});
    return { medium: "a4", pagePrinterId: printer.id };
  }
  if (typeof delivery.recipient !== "string" || !isValidEmail(delivery.recipient)) {
    invalid("delivery.recipient");
  }
  const consent = delivery.consent;
  if (
    !object(consent) ||
    consent.accepted !== true ||
    consent.statementVersion !== "invoice-email-v1"
  ) {
    invalid("delivery.consent");
  }
  if (input.context?.emailAvailable !== true) {
    throw new AppError("invoice_delivery.email_unavailable", {});
  }
  const [location] = await tx
    .select({ locales: locations.invoiceLocales })
    .from(locations)
    .where(eq(locations.id, input.locationId));
  const contact = await getReceipt(tx);
  if (typeof contact.email !== "string" || !isValidEmail(contact.email)) {
    throw new AppError("invoice_delivery.email_unavailable", {});
  }
  if (
    typeof consent.language !== "string" ||
    !location!.locales.includes(consent.language) ||
    consent.contactEmail !== contact.email ||
    consent.contactPhone !== contact.phone
  ) {
    invalid("delivery.consent");
  }
  return {
    medium: "email",
    recipient: delivery.recipient.trim(),
    consent: {
      statementVersion: "invoice-email-v1",
      language: consent.language,
      recordedAt: (input.context.now ?? new Date()).toISOString(),
      personId: input.context.personId,
      contactEmail: contact.email,
      ...(contact.phone === undefined ? {} : { contactPhone: contact.phone }),
    },
  };
}

export async function reserveStagedInvoiceDelivery(
  tx: Transaction,
  saleId: string,
): Promise<boolean> {
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
  const personId =
    sale.personId ?? (delivery.medium === "email" ? delivery.consent.personId : null);
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
}
