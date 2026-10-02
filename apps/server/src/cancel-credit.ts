import { eq } from "drizzle-orm";
import { readLiveSeriesIdTx, saleLines, sales } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { recordCorrection, settleSale } from "@waitron/core";
import type { RecordSaleLine } from "@waitron/core";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { AuthzInput } from "@waitron/identity";
import {
  basisPointsToDecimal,
  centsToDecimal,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
  thousandthsToDecimal,
} from "@waitron/shared";
import type { SaleId, TillId } from "@waitron/shared";
import type { TillConfig } from "./till-config.js";

/** The invoice a working order issued, as {@link creditWholeInvoice} credits it. */
export interface IssuedInvoice {
  id: SaleId;
  total: number;
}

/** The invoice this working order issued; `sales_working_order_id_key` allows at most one. */
export async function readOrderInvoice(
  tx: Transaction,
  workingOrderId: string,
): Promise<IssuedInvoice | undefined> {
  const [row] = await tx
    .select({ id: sales.id, total: sales.total })
    .from(sales)
    .where(eq(sales.workingOrderId, workingOrderId));
  return row === undefined ? undefined : { ...row, id: brandSaleId(row.id) };
}

/**
 * Credit the whole of an issued invoice with a corrective invoice in the node's live rectificative
 * series, filed on `saleTillId`, its lines the invoice's with their signs reversed and its VAT
 * breakdown the invoice's own negated (`wholeInvoice`), then settle the invoice owing nothing.
 * `recordCorrection` checks `sale.rectify` against `authz` and counts nothing, so an override in
 * `authz` must already have been checked under a wrong-PIN limit.
 */
export async function creditWholeInvoice(
  tx: Transaction,
  deps: { backend: FiscalBackend; clock: TrustedClock },
  cfg: TillConfig,
  invoice: IssuedInvoice,
  authz: AuthzInput,
  saleTillId: TillId,
): Promise<void> {
  const seriesId = brandSeriesId(await readLiveSeriesIdTx(tx, cfg.nodeId, "rectificative"));
  const total = centsToDecimal(-invoice.total);
  const lines = reversedLines(
    await tx
      .select()
      .from(saleLines)
      .where(eq(saleLines.saleId, invoice.id))
      .orderBy(saleLines.lineNo),
  );
  await recordCorrection(tx, deps.backend, {
    tillId: saleTillId,
    nodeId: cfg.nodeId,
    seriesId,
    correctsSaleId: invoice.id,
    total,
    lines,
    wholeInvoice: true,
    authz,
    clock: deps.clock,
  });
  await settleSale(tx, { saleId: invoice.id, tenders: [] });
}

function reversedLines(rows: (typeof saleLines.$inferSelect)[]): RecordSaleLine[] {
  const lineNoOf = new Map(rows.map((row) => [row.id, row.lineNo]));
  return rows.map(
    (row) =>
      ({
        lineNo: row.lineNo,
        name: row.name,
        descriptions: row.descriptions,
        unitName: row.unitName,
        unitPrecision: row.unitPrecision,
        quantity: thousandthsToDecimal(-row.quantity),
        unitPrice: centsToDecimal(row.unitPrice),
        vatRate: basisPointsToDecimal(row.vatRate),
        lineTotal: centsToDecimal(-row.lineTotal),
        category: row.category,
        parentLineNo: row.parentLineId === null ? null : lineNoOf.get(row.parentLineId)!,
        optionSnapshots: row.optionSnapshots,
        variantName: row.variantName,
        variantDescriptions: row.variantDescriptions,
        variantKitchenName: row.variantKitchenName,
        kitchenName: row.kitchenName,
        productId: row.productId,
        parentProductId: row.parentProductId,
        menuId: row.menuId,
        menuVersionId: row.menuVersionId,
        lineGross: row.lineGross === null ? null : centsToDecimal(-row.lineGross),
        classification: row.classification,
      }) satisfies Required<RecordSaleLine>,
  );
}
