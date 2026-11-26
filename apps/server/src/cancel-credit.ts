import "./errors.js";
import { prepareIssueClock } from "@waitron/fiscal";
import { requireEconomicWrite, type TradingAdmission } from "./trading-admission.js";
import { readSaleOperationDescription } from "./sale-operation-description.js";
import { eq, inArray } from "drizzle-orm";
import { readLiveSeriesIdTx, saleLines, saleSubstitutions, sales } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { correctionTargetFor, recordCorrection, settleSale } from "@waitron/core";
import type { RecordCorrectionInput, RecordSaleLine } from "@waitron/core";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import {
  basisPointsToDecimal,
  centsToDecimal,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
  thousandthsToDecimal,
} from "@waitron/shared";
import { AppError, type SaleId } from "@waitron/shared";
import { holdsPayment } from "./bill-payments.js";
import { servedOrCharged } from "./served-dishes.js";
import type { DeviceRequestConfig } from "./trading-context.js";

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
 * What a cancel files for the bill's invoice, by the permission it needs: a cancellation
 * (`sale.void`) when the bill never held a payment (one given back counts), the invoice has no
 * corrective, replacement or full invoice in its place and names no customer; otherwise a
 * corrective (`sale.rectify`).
 */
export async function cancelPermission(
  tx: Transaction,
  workingOrderId: string,
  invoice: IssuedInvoice,
): Promise<"sale.void" | "sale.rectify"> {
  if (await holdsPayment(tx, workingOrderId)) return "sale.rectify";
  const [sale] = await tx
    .select({ counterpartyTaxId: sales.counterpartyTaxId })
    .from(sales)
    .where(eq(sales.id, invoice.id));
  if (sale!.counterpartyTaxId !== null) return "sale.rectify";
  const [corrective] = await tx
    .select({ id: sales.id })
    .from(sales)
    .where(eq(sales.correctsSaleId, invoice.id))
    .limit(1);
  return corrective === undefined && !(await substituted(tx, [invoice.id]))
    ? "sale.void"
    : "sale.rectify";
}

/** Whether a full invoice took the place of any of `saleIds`. */
async function substituted(tx: Transaction, saleIds: SaleId[]): Promise<boolean> {
  const [row] = await tx
    .select({ id: saleSubstitutions.id })
    .from(saleSubstitutions)
    .where(inArray(saleSubstitutions.substitutedSaleId, saleIds))
    .limit(1);
  return row !== undefined;
}

/** Refuses `bill.served_dishes` while {@link servedOrCharged} names any of the bill's rows. */
export async function refuseServedDishes(tx: Transaction, workingOrderId: string): Promise<void> {
  const dishes = await servedOrCharged(tx, workingOrderId);
  if (dishes.length > 0) throw new AppError("bill.served_dishes", { workingOrderId, dishes });
}

/**
 * Credit the whole of an issued invoice with a corrective invoice in the node's live corrective
 * series, filed under the request's device, its lines the invoice's with their signs reversed and its VAT
 * breakdown the invoice's own negated (`wholeInvoice`), then settle the invoice owing nothing.
 * `recordCorrection` checks `authz` and counts nothing, so an override in `authz` must already have
 * been checked under a wrong-PIN limit. Answers the corrective's id.
 */
export async function creditWholeInvoice(
  tx: Transaction,
  deps: { backend: FiscalBackend; clock: TrustedClock; admission: TradingAdmission },
  cfg: DeviceRequestConfig,
  invoice: IssuedInvoice,
  authz: RecordCorrectionInput["authz"],
): Promise<SaleId> {
  await requireEconomicWrite(tx, cfg, deps.admission);
  // A replaced invoice is credited through its replacement, whose lines repeat the invoice's.
  const target = await correctionTargetFor(tx, invoice.id);
  // `recordCorrection` does not look for a full invoice in the place of the receipt or of its
  // replacement, as core's correction history does.
  if (await substituted(tx, [invoice.id, target]))
    throw new AppError("sale.correction_not_admitted", { reason: "replaced" });
  const clock = await prepareIssueClock(tx, cfg, deps.clock);
  const seriesId = brandSeriesId(await readLiveSeriesIdTx(tx, cfg.nodeId, "corrective"));
  const total = centsToDecimal(-invoice.total);
  const lines = reversedLines(
    await tx.select().from(saleLines).where(eq(saleLines.saleId, target)).orderBy(saleLines.lineNo),
  );
  const operationDescription = await readSaleOperationDescription(tx, cfg, {
    kind: "sale",
    saleId: invoice.id,
  });
  const credit = await recordCorrection(tx, deps.backend, {
    operationDescription,
    origin: cfg.origin,
    nodeId: cfg.nodeId,
    seriesId,
    correctsSaleId: target,
    total,
    lines,
    wholeInvoice: true,
    authz,
    clock,
  });
  await settleSale(tx, { saleId: invoice.id, tenders: [] });
  return credit.saleId;
}

export function reversedLines(rows: (typeof saleLines.$inferSelect)[]): RecordSaleLine[] {
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
        priceQuantity: thousandthsToDecimal(row.priceQuantity),
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
        listGross: row.listGross === null ? null : centsToDecimal(-row.listGross),
        listUnitPriceGross:
          row.listUnitPriceGross === null ? null : centsToDecimal(row.listUnitPriceGross),
        classification: row.classification,
        correctsLineId: row.id,
        advanceRole: row.advanceRole,
        deductsSaleId: row.deductsSaleId,
        setMenuRole: row.setMenuRole,
        setMenuPart: row.setMenuPart === null ? null : centsToDecimal(-row.setMenuPart),
      }) satisfies Required<RecordSaleLine>,
  );
}
