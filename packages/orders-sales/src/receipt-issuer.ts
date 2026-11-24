import { readInvoiceTyping, type InvoiceTyping, type TypedSale } from "./invoice-typing.js";
import { eq } from "drizzle-orm";
import { sales } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { FiledInvoiceEvidence, FiscalBackend } from "@waitron/fiscal";
import type { SaleId } from "@waitron/shared";

export interface ReceiptIssuerFacts extends InvoiceTyping {
  issuer?: { venueName: string; nif: string; domicile?: string };
  issuedOffsetMinutes?: number;
  invoiceEvidence?: FiledInvoiceEvidence;
}

type IssuerSale = TypedSale & Pick<typeof sales.$inferSelect, "taxpayerDomicile">;

/** `loaded` is the sale's own row when the caller already holds it; otherwise it is read here. */
export async function readReceiptIssuer(
  backend: FiscalBackend,
  tx: Transaction,
  saleId: SaleId,
  loaded?: IssuerSale,
): Promise<ReceiptIssuerFacts> {
  const filed = await backend.filedReceiptFor(tx, saleId);
  const [sale] = loaded
    ? [loaded]
    : await tx
        .select({
          taxpayerDomicile: sales.taxpayerDomicile,
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
      ...(sale?.taxpayerDomicile === null || sale?.taxpayerDomicile === undefined
        ? {}
        : { domicile: sale.taxpayerDomicile }),
    },
  };
}
