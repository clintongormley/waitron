import { and, eq } from "drizzle-orm";
import { allocateInvoiceNumber, invoiceSeries, sales } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { saleId as brandSaleId, stringToCents } from "@waitron/shared";
import type { SaleId } from "@waitron/shared";

/**
 * Inserts a corrective of `correctsSaleId` directly, numbered next in its node's rectificative
 * series: a replacement repeating the corrected sale's total, or, with `total`, an ordinary
 * corrective such as a refund of a replacement.
 */
export async function insertCorrective(
  tx: Transaction,
  correctsSaleId: string,
  change: { replaces: true } | { total: string },
): Promise<SaleId> {
  const [corrected] = await tx.select().from(sales).where(eq(sales.id, correctsSaleId));
  const [series] = await tx
    .select({ id: invoiceSeries.id })
    .from(invoiceSeries)
    .where(
      and(eq(invoiceSeries.nodeId, corrected!.nodeId), eq(invoiceSeries.purpose, "rectificative")),
    );
  const invoiceNumber = await allocateInvoiceNumber(tx, series!.id);
  const replaces = "replaces" in change;
  const [row] = await tx
    .insert(sales)
    .values({
      source: corrected!.source,
      deviceId: corrected!.deviceId,
      nodeId: corrected!.nodeId,
      seriesId: series!.id,
      invoiceNumber,
      issuedAt: corrected!.issuedAt,
      issuedOffsetMinutes: corrected!.issuedOffsetMinutes,
      total: replaces ? corrected!.total : stringToCents(change.total),
      vatBreakdown: replaces ? corrected!.vatBreakdown : [],
      locale: corrected!.locale,
      invoiceLocales: corrected!.invoiceLocales,
      fiscalBackend: corrected!.fiscalBackend,
      fiscalState: "recorded",
      correctsSaleId,
      replacesOriginal: replaces,
    })
    .returning({ id: sales.id });
  return brandSaleId(row!.id);
}
