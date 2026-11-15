import { readInvoiceTyping, type InvoiceTyping } from "./invoice-typing.js";
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
    Pick<TillSaleResult, "issuer" | "issuedOffsetMinutes" | "invoiceEvidence"> & InvoiceTyping
  >
> {
  const filed = await backend.filedReceiptFor(tx, saleId);
  const [sale] = await tx
    .select({
      domicile: sales.taxpayerDomicile,
      issuedOffsetMinutes: sales.issuedOffsetMinutes,
      issuedAt: sales.issuedAt,
      correctsSaleId: sales.correctsSaleId,
      replacesOriginal: sales.replacesOriginal,
      supplyDay: sales.supplyDay,
      counterpartyTaxId: sales.counterpartyTaxId,
      counterpartyIdentifierType: sales.counterpartyIdentifierType,
      counterpartyIdentifierCountryCode: sales.counterpartyIdentifierCountryCode,
      counterpartyLegalName: sales.counterpartyLegalName,
      counterpartyCountryCode: sales.counterpartyCountryCode,
      counterpartyAddress: sales.counterpartyAddress,
    })
    .from(sales)
    .where(eq(sales.id, saleId));
  const issueOffset = sale === undefined ? {} : { issuedOffsetMinutes: sale.issuedOffsetMinutes };
  if (!filed?.issuer) return issueOffset;
  const invoiceEvidence = await backend.invoiceEvidenceFor?.(tx, saleId);
  return {
    ...issueOffset,
    ...(invoiceEvidence === undefined ? {} : { invoiceEvidence }),
    ...(sale === undefined ? { invoiceType: "F2" as const } : await readInvoiceTyping(tx, sale)),
    issuer: {
      venueName: filed.issuer.legalName,
      nif: filed.issuer.taxId,
      ...(sale?.domicile === null || sale?.domicile === undefined
        ? {}
        : { domicile: sale.domicile }),
    },
  };
}
