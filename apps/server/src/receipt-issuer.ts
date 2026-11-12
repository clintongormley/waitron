import { storedRecipientIdentifier } from "./invoice-selection.js";
import { eq } from "drizzle-orm";
import { sales } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import type { SaleId } from "@waitron/shared";
import type { TillSaleResult } from "./till-sale.js";

export async function readReceiptIssuer(
  backend: FiscalBackend,
  tx: Transaction,
  saleId: SaleId,
): Promise<
  Partial<
    Pick<
      TillSaleResult,
      "issuer" | "recipient" | "invoiceType" | "issuedOffsetMinutes" | "invoiceEvidence"
    >
  >
> {
  const filed = await backend.filedReceiptFor(tx, saleId);
  const [sale] = await tx
    .select({
      domicile: sales.taxpayerDomicile,
      issuedOffsetMinutes: sales.issuedOffsetMinutes,
      recipientTaxId: sales.counterpartyTaxId,
      identifierType: sales.counterpartyIdentifierType,
      identifierCountryCode: sales.counterpartyIdentifierCountryCode,
      recipientLegalName: sales.counterpartyLegalName,
      recipientCountryCode: sales.counterpartyCountryCode,
      recipientAddress: sales.counterpartyAddress,
    })
    .from(sales)
    .where(eq(sales.id, saleId));
  const issueOffset = sale === undefined ? {} : { issuedOffsetMinutes: sale.issuedOffsetMinutes };
  if (!filed?.issuer) return issueOffset;
  const invoiceEvidence = await backend.invoiceEvidenceFor?.(tx, saleId);
  return {
    ...issueOffset,
    ...(invoiceEvidence === undefined ? {} : { invoiceEvidence }),
    invoiceType:
      sale?.recipientTaxId === null || sale === undefined ? ("F2" as const) : ("F1" as const),
    ...(sale?.recipientTaxId !== null &&
    sale?.recipientTaxId !== undefined &&
    sale.recipientLegalName !== null &&
    sale.recipientCountryCode !== null &&
    sale.recipientAddress !== null
      ? {
          recipient: {
            taxId: sale.recipientTaxId,
            ...storedRecipientIdentifier(sale.identifierType, sale.identifierCountryCode),
            legalName: sale.recipientLegalName,
            countryCode: sale.recipientCountryCode,
            address: sale.recipientAddress,
          },
        }
      : {}),
    issuer: {
      venueName: filed.issuer.legalName,
      nif: filed.issuer.taxId,
      ...(sale?.domicile === null || sale?.domicile === undefined
        ? {}
        : { domicile: sale.domicile }),
    },
  };
}
