import { eq } from "drizzle-orm";
import {
  billAdvances,
  invoiceSeries,
  readTaxpayer,
  saleLines,
  saleSettlements,
  sales,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { formatInvoiceNumber } from "@waitron/core";
import type { FiscalBackend } from "@waitron/fiscal";
import {
  AppError,
  type Decimal,
  addDecimal,
  basisPointsToDecimal,
  compareDecimal,
  decimal,
  percentOf,
  subtractDecimal,
  centsToDecimal,
  saleId as brandSaleId,
  thousandthsToDecimal,
} from "@waitron/shared";
import type { TradingContext } from "./trading-context.js";
import { receiptLines } from "./receipt-adjustments.js";
import { readReceiptIssuer } from "./receipt-issuer.js";
import { readInvoiceTyping } from "./invoice-typing.js";
import { readReceiptOrder } from "./receipt-order.js";
import { readReceiptPresentation } from "./receipt-presentation.js";
import { readReceiptPayments } from "./receipt-payments.js";
import { readTenderBlock, receiptQr, type TillSaleResult } from "./till-sale.js";
import { resolveTransactionScope } from "./find-bill-transactions.js";
import "./errors.js";

function receiptGrosses(
  rows: (typeof saleLines.$inferSelect)[],
  bands: TillSaleResult["vatBreakdown"],
): Map<string, Decimal> {
  const amounts = new Map(
    rows.map((row) => {
      const base = centsToDecimal(row.lineTotal);
      return [
        row.id,
        row.lineGross === null
          ? addDecimal(base, percentOf(base, basisPointsToDecimal(row.vatRate)))
          : centsToDecimal(row.lineGross),
      ];
    }),
  );
  for (const band of bands) {
    const atRate = rows.filter(
      (row) => compareDecimal(basisPointsToDecimal(row.vatRate), decimal(band.rate)) === 0,
    );
    const last = [...atRate].reverse().find((row) => row.lineGross === null);
    if (last === undefined) continue;
    // The filed VAT group owns rounding; only an absent line gross takes its remainder.
    let remainder = addDecimal(decimal(band.base), decimal(band.tax));
    for (const row of atRate)
      if (row.id !== last.id) remainder = subtractDecimal(remainder, decimal(amounts.get(row.id)!));
    amounts.set(last.id, remainder);
  }
  return amounts;
}

export async function readTransactionReceipt(
  backend: FiscalBackend,
  tx: Transaction,
  cfg: TradingContext,
  saleId: string,
): Promise<TillSaleResult> {
  const scope = await resolveTransactionScope(tx, saleId);
  const [issued] = await tx
    .select({ sale: sales, code: invoiceSeries.code, settlementId: saleSettlements.id })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .leftJoin(saleSettlements, eq(saleSettlements.saleId, sales.id))
    .where(eq(sales.id, saleId));
  if (issued === undefined) throw new AppError("sale.not_found", { saleId });
  const { sale } = issued;
  const rows = await tx
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(saleLines.lineNo);
  const byId = new Map(rows.map((row) => [row.id, row.lineNo]));
  const grosses = receiptGrosses(rows, sale.vatBreakdown);
  // `receiptLines` adds the lines that take an advance off, naming each advance.
  const dishes = rows.filter((row) => row.advanceRole !== "deduction");
  const orderLines =
    sale.workingOrderId === null
      ? []
      : await tx
          .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, sale.workingOrderId));
  const orderIds = new Map(orderLines.map((row) => [row.lineNo, row.id]));
  const lines = await receiptLines(
    tx,
    sale.workingOrderId,
    {
      lines: dishes.map((row) => ({
        lineNo: row.lineNo,
        descriptions: row.descriptions,
        variantDescriptions: row.variantDescriptions,
        variantName: row.variantName,
        optionSnapshots: row.optionSnapshots,
        unitName: row.unitName,
        unitPrecision: row.unitPrecision,
        quantity: thousandthsToDecimal(row.quantity),
        priceQuantity: thousandthsToDecimal(row.priceQuantity),
        lineGross: grosses.get(row.id)!,
        parentLineNo: row.parentLineId === null ? null : byId.get(row.parentLineId),
      })),
    },
    dishes.map((row) => ({ id: orderIds.get(row.lineNo) ?? row.id, listUnitGross: null })),
    saleId,
  );
  const filed = await backend.filedReceiptFor(tx, brandSaleId(saleId));
  const issuer = await readReceiptIssuer(backend, tx, brandSaleId(saleId), sale);
  const taxpayer = issuer.issuer === undefined ? await readTaxpayer(tx) : null;
  const groupId =
    sale.workingOrderId ??
    (scope.workingOrderIds.length === 1 ? scope.workingOrderIds[0] : undefined);
  // An advance keeps the heading its line was worded under; its bill's may move until the bill's
  // own invoice.
  const [advance] = await tx
    .select({ orderLabel: billAdvances.orderLabel })
    .from(billAdvances)
    .where(eq(billAdvances.advanceSaleId, saleId));
  return {
    ...(groupId === undefined
      ? { orderLabel: null, orderNumber: 0 }
      : await readReceiptOrder(tx, groupId)),
    ...(advance === undefined ? {} : { orderLabel: advance.orderLabel }),
    ...(await readReceiptPresentation(tx, saleId, sale.locale, cfg.practiceMode === true)),
    ...issuer,
    ...(issuer.issuer === undefined && taxpayer !== null
      ? {
          issuer: {
            venueName: taxpayer.legalName,
            nif: taxpayer.taxId,
            ...(sale.taxpayerDomicile === null ? {} : { domicile: sale.taxpayerDomicile }),
          },
        }
      : {}),
    ...(issuer.invoiceType === undefined ? await readInvoiceTyping(tx, sale) : {}),
    issuedOffsetMinutes: sale.issuedOffsetMinutes,
    locale: sale.locale,
    namesLocale: sale.invoiceLocales[0]!,
    invoiceNumber: formatInvoiceNumber(issued.code, sale.invoiceNumber),
    issuedAt: new Date(sale.issuedAt).toISOString(),
    total: centsToDecimal(sale.total),
    vatBreakdown: sale.vatBreakdown,
    ...lines,
    tender: await readTenderBlock(tx, brandSaleId(saleId), sale.workingOrderId),
    ...(await readReceiptPayments(
      tx,
      brandSaleId(saleId),
      sale.workingOrderId,
      issued.settlementId !== null,
    )),
    ...receiptQr(backend, filed?.verificationUrl),
  };
}
