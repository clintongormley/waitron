import { and, eq, isNotNull, isNull, type SQL } from "drizzle-orm";
import {
  getCountryPack,
  normalizeRecipientCountryCode,
  recipientIdentifierResult,
} from "@waitron/country-packs";
import { readLiveSeriesIdTx, sales, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { refuseOverSimplifiedLimit } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import type { RecipientIdentifier, RecipientIdentifierType } from "@waitron/country-packs";
import type { FiscalBackend } from "@waitron/fiscal";
import { AppError, seriesId } from "@waitron/shared";
import type { Decimal, NodeId } from "@waitron/shared";
import "./errors.js";

export interface InvoiceRecipient extends RecipientIdentifier {
  legalName: string;
  address: string;
  countryCode: string;
}

export function storedRecipientIdentifier(
  type: string | null,
  country: string | null,
): Pick<RecipientIdentifier, "identifierType" | "identifierCountryCode"> {
  return type === null
    ? {}
    : { identifierType: type as RecipientIdentifierType, identifierCountryCode: country! };
}

/**
 * Whether a stored sale is delivered as a full invoice: it names a customer and is not a
 * corrective.
 */
export function deliversAsFullInvoice(row: {
  counterpartyTaxId: string | null;
  correctsSaleId: string | null;
}): boolean {
  return row.counterpartyTaxId !== null && row.correctsSaleId === null;
}

/** {@link deliversAsFullInvoice} as a filter on `sales`. */
export function deliversAsFullInvoiceSql(): SQL {
  return and(isNotNull(sales.counterpartyTaxId), isNull(sales.correctsSaleId))!;
}

export function checkedInvoiceRecipient(
  backend: Pick<FiscalBackend, "recipientNameMaxLength">,
  recipient: unknown,
): InvoiceRecipient {
  const identity = recipientIdentifierResult(recipient);
  if (!identity.valid) {
    throw new AppError("invoice.recipient_invalid", { field: identity.field });
  }
  const value = recipient as Record<string, unknown>;
  if (
    !("legalName" in value) ||
    typeof value.legalName !== "string" ||
    value.legalName.trim() === "" ||
    (backend.recipientNameMaxLength !== null &&
      Array.from(value.legalName.trim()).length > backend.recipientNameMaxLength)
  ) {
    throw new AppError("invoice.recipient_invalid", { field: "legalName" });
  }
  if (!("address" in value) || typeof value.address !== "string" || value.address.trim() === "") {
    throw new AppError("invoice.recipient_invalid", { field: "address" });
  }
  const countryCode = normalizeRecipientCountryCode(value.countryCode);
  if (countryCode === undefined) {
    throw new AppError("management.request_invalid", { field: "recipient.countryCode" });
  }
  if (countryCode === "ES" && !getCountryPack("ES")!.postalAddress!.isComplete(value.address)) {
    throw new AppError("invoice.recipient_invalid", { field: "address" });
  }
  return {
    ...identity.value,
    legalName: value.legalName.trim(),
    address: value.address.trim(),
    countryCode,
  };
}

/** The order columns {@link selectOrderInvoice} chooses the invoice from, for a select. */
export const ORDER_INVOICE_CHOICE = {
  invoiceType: workingOrders.invoiceType,
  recipientTaxId: workingOrders.recipientTaxId,
  recipientIdentifierType: workingOrders.recipientIdentifierType,
  recipientIdentifierCountryCode: workingOrders.recipientIdentifierCountryCode,
  recipientLegalName: workingOrders.recipientLegalName,
  recipientAddress: workingOrders.recipientAddress,
  recipientCountryCode: workingOrders.recipientCountryCode,
  receiptLocale: workingOrders.receiptLocale,
};

/** An order's {@link ORDER_INVOICE_CHOICE} columns. */
export type OrderInvoiceChoice = Pick<
  typeof workingOrders.$inferSelect,
  keyof typeof ORDER_INVOICE_CHOICE
>;

/** The order's {@link OrderInvoiceChoice}; absent for an unknown order. */
export async function readOrderInvoiceChoice(
  tx: Transaction,
  orderId: string,
): Promise<OrderInvoiceChoice | undefined> {
  const [order] = await tx
    .select(ORDER_INVOICE_CHOICE)
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  return order;
}

/** `choice` is the order's {@link OrderInvoiceChoice} when the caller has read it in this
 * transaction, with none of its columns written since. */
export async function selectOrderInvoice(
  tx: Transaction,
  backend: Pick<FiscalBackend, "recipientNameMaxLength">,
  cfg: { nodeId: NodeId; simplifiedInvoiceLimit: Decimal | null },
  orderId: string,
  total: Decimal,
  choice?: OrderInvoiceChoice,
): Promise<{
  invoiceType: "F1" | "F2";
  recipient: InvoiceRecipient | undefined;
  sale: Pick<RecordSaleInput, "seriesId" | "counterparty" | "recipientAddress">;
  /** The receipt language saved on the order; absent when none is. */
  receiptLocale?: string;
}> {
  const order = choice ?? (await readOrderInvoiceChoice(tx, orderId));
  if (order === undefined) {
    throw new AppError("working_order.not_open", { workingOrderId: orderId });
  }
  const receiptLocale = order.receiptLocale === null ? {} : { receiptLocale: order.receiptLocale };
  if (order.invoiceType === "F2") {
    refuseOverSimplifiedLimit(cfg.simplifiedInvoiceLimit, total);
    return {
      invoiceType: "F2",
      recipient: undefined,
      sale: {
        seriesId: seriesId(await readLiveSeriesIdTx(tx, cfg.nodeId, "standard")),
        counterparty: null,
        recipientAddress: null,
      },
      ...receiptLocale,
    };
  }
  const recipient = checkedInvoiceRecipient(backend, {
    taxId: order.recipientTaxId!,
    ...storedRecipientIdentifier(
      order.recipientIdentifierType,
      order.recipientIdentifierCountryCode,
    ),
    legalName: order.recipientLegalName!,
    address: order.recipientAddress!,
    countryCode: order.recipientCountryCode!,
  });
  return {
    invoiceType: "F1",
    recipient,
    sale: {
      seriesId: seriesId(await readLiveSeriesIdTx(tx, cfg.nodeId, "full")),
      counterparty: {
        taxId: recipient.taxId,
        ...(recipient.identifierType === undefined
          ? {}
          : {
              identifierType: recipient.identifierType,
              identifierCountryCode: recipient.identifierCountryCode,
            }),
        legalName: recipient.legalName,
        countryCode: recipient.countryCode,
      },
      recipientAddress: recipient.address,
    },
    ...receiptLocale,
  };
}
