import { eq } from "drizzle-orm";
import { sales } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import type { SaleId } from "@waitron/shared";

export async function readReceiptIssuer(backend: FiscalBackend, tx: Transaction, saleId: SaleId) {
  const filed = await backend.filedReceiptFor(tx, saleId);
  if (!filed?.issuer) return {};
  const [sale] = await tx
    .select({
      domicile: sales.taxpayerDomicile,
      operationDate: sales.operationDate,
      issuedAt: sales.issuedAt,
      issuedOffsetMinutes: sales.issuedOffsetMinutes,
      recipientTaxId: sales.counterpartyTaxId,
      recipientLegalName: sales.counterpartyLegalName,
      recipientCountryCode: sales.counterpartyCountryCode,
      recipientAddress: sales.counterpartyAddress,
    })
    .from(sales)
    .where(eq(sales.id, saleId));
  const issueDay =
    sale === undefined
      ? undefined
      : new Date(new Date(sale.issuedAt).getTime() + sale.issuedOffsetMinutes * 60_000)
          .toISOString()
          .slice(0, 10);
  return {
    ...(sale?.recipientTaxId != null ? { issuedOffsetMinutes: sale.issuedOffsetMinutes } : {}),
    ...(sale?.recipientTaxId != null &&
    sale.operationDate !== null &&
    sale.operationDate !== issueDay
      ? { operationDate: sale.operationDate }
      : {}),
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
