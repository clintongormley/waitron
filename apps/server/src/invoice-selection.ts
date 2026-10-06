import { and, eq } from "drizzle-orm";
import { getCountryPack } from "@waitron/country-packs";
import { readLiveSeriesIdTx, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { refuseOverSimplifiedLimit } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import type { FiscalBackend } from "@waitron/fiscal";
import { AppError, seriesId } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

export interface InvoiceRecipient {
  taxId: string;
  legalName: string;
  address: string;
  countryCode: string;
}

function completeSpanishPostalAddress(address: string): boolean {
  const parts = address.split(",").map((part) => part.trim());
  const streetParts = parts.slice(0, -3);
  const postalLocality = parts.at(-3);
  const province = parts.at(-2);
  const country = parts.at(-1);
  return (
    parts.length >= 4 &&
    streetParts.every((part) => part !== "") &&
    /^\d{5}\s+\S/u.test(postalLocality ?? "") &&
    province !== "" &&
    country === "España"
  );
}

export function checkedInvoiceRecipient(
  backend: Pick<FiscalBackend, "recipientNameMaxLength">,
  recipient: unknown,
): InvoiceRecipient {
  if (
    recipient === null ||
    typeof recipient !== "object" ||
    !("taxId" in recipient) ||
    typeof recipient.taxId !== "string"
  ) {
    throw new AppError("invoice.recipient_invalid", { field: "taxId" });
  }
  const taxId = getCountryPack("ES")!.taxIdentifier!.validate(recipient.taxId);
  if (!taxId.valid) {
    throw new AppError("invoice.recipient_invalid", { field: "taxId" });
  }
  if (
    !("legalName" in recipient) ||
    typeof recipient.legalName !== "string" ||
    recipient.legalName.trim() === "" ||
    (backend.recipientNameMaxLength !== null &&
      Array.from(recipient.legalName.trim()).length > backend.recipientNameMaxLength)
  ) {
    throw new AppError("invoice.recipient_invalid", { field: "legalName" });
  }
  if (
    !("address" in recipient) ||
    typeof recipient.address !== "string" ||
    !completeSpanishPostalAddress(recipient.address)
  ) {
    throw new AppError("invoice.recipient_invalid", { field: "address" });
  }
  if (
    !("countryCode" in recipient) ||
    typeof recipient.countryCode !== "string" ||
    !/^[A-Za-z]{2}$/.test(recipient.countryCode)
  ) {
    throw new AppError("management.request_invalid", { field: "recipient.countryCode" });
  }
  if (recipient.countryCode.toUpperCase() !== "ES") {
    throw new AppError("fiscal.foreign_recipient_unsupported", {
      countryCode: recipient.countryCode.toUpperCase(),
    });
  }
  return {
    taxId: taxId.normalized,
    legalName: recipient.legalName.trim(),
    address: recipient.address.trim(),
    countryCode: "ES",
  };
}

export async function selectOrderInvoice(
  tx: Transaction,
  backend: Pick<FiscalBackend, "recipientNameMaxLength">,
  cfg: Pick<TillConfig, "nodeId" | "seriesId" | "simplifiedInvoiceLimit">,
  orderId: string,
  total: Decimal,
): Promise<{
  invoiceType: "F1" | "F2";
  recipient: InvoiceRecipient | undefined;
  sale: Pick<RecordSaleInput, "seriesId" | "counterparty" | "recipientAddress">;
}> {
  const [order] = await tx
    .select({
      invoiceType: workingOrders.invoiceType,
      recipientTaxId: workingOrders.recipientTaxId,
      recipientLegalName: workingOrders.recipientLegalName,
      recipientAddress: workingOrders.recipientAddress,
      recipientCountryCode: workingOrders.recipientCountryCode,
    })
    .from(workingOrders)
    .where(and(eq(workingOrders.id, orderId), eq(workingOrders.nodeId, cfg.nodeId)));
  if (order === undefined) {
    throw new AppError("working_order.not_open", { workingOrderId: orderId });
  }
  if (order.invoiceType === "F2") {
    refuseOverSimplifiedLimit(cfg.simplifiedInvoiceLimit, total);
    return {
      invoiceType: "F2",
      recipient: undefined,
      sale: { seriesId: cfg.seriesId, counterparty: null, recipientAddress: null },
    };
  }
  const recipient = checkedInvoiceRecipient(backend, {
    taxId: order.recipientTaxId!,
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
        legalName: recipient.legalName,
        countryCode: recipient.countryCode,
      },
      recipientAddress: recipient.address,
    },
  };
}
