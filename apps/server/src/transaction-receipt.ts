import { eq } from "drizzle-orm";
import {
  invoiceSeries,
  readTenant,
  saleLines,
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
import type { TillConfig } from "./till-config.js";
import { receiptLines } from "./receipt-adjustments.js";
import { readReceiptIssuer } from "./receipt-issuer.js";
import { readReceiptOrder } from "./receipt-order.js";
import { readReceiptPresentation } from "./receipt-presentation.js";
import {
  readBillTenderLines,
  readTenderBlock,
  receiptQr,
  type TillSaleResult,
} from "./till-sale.js";
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
  cfg: TillConfig,
  saleId: string,
): Promise<TillSaleResult> {
  const scope = await resolveTransactionScope(tx, cfg, saleId);
  const [issued] = await tx
    .select({ sale: sales, code: invoiceSeries.code })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
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
      lines: rows.map((row) => ({
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
    rows.map((row) => ({ id: orderIds.get(row.lineNo) ?? row.id, listUnitGross: null })),
    saleId,
  );
  const filed = await backend.filedReceiptFor(tx, brandSaleId(saleId));
  const payments = await readBillTenderLines(tx, brandSaleId(saleId));
  const issuer: Partial<
    Pick<
      TillSaleResult,
      "issuer" | "recipient" | "invoiceType" | "issuedOffsetMinutes" | "operationDate"
    >
  > = await readReceiptIssuer(backend, tx, brandSaleId(saleId));
  const taxpayer = issuer.issuer === undefined ? await readTenant(tx) : null;
  const groupId =
    sale.workingOrderId ??
    (scope.workingOrderIds.length === 1 ? scope.workingOrderIds[0] : undefined);
  const issueDay = new Date(new Date(sale.issuedAt).getTime() + sale.issuedOffsetMinutes * 60000)
    .toISOString()
    .slice(0, 10);
  return {
    ...(groupId === undefined
      ? { orderLabel: null, orderNumber: 0 }
      : await readReceiptOrder(tx, cfg, groupId)),
    ...(await readReceiptPresentation(tx, cfg, saleId, sale.locale)),
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
    invoiceType: sale.counterpartyTaxId === null ? "F2" : "F1",
    ...(sale.counterpartyTaxId === null
      ? {}
      : {
          recipient: {
            taxId: sale.counterpartyTaxId,
            legalName: sale.counterpartyLegalName!,
            countryCode: sale.counterpartyCountryCode!,
            address: sale.counterpartyAddress!,
          },
        }),
    issuedOffsetMinutes: sale.issuedOffsetMinutes,
    ...(sale.operationDate !== null && sale.operationDate !== issueDay
      ? { operationDate: sale.operationDate }
      : {}),
    locale: sale.locale,
    namesLocale: sale.invoiceLocales[0]!,
    invoiceNumber: formatInvoiceNumber(issued.code, sale.invoiceNumber),
    issuedAt: new Date(sale.issuedAt).toISOString(),
    total: centsToDecimal(sale.total),
    vatBreakdown: sale.vatBreakdown,
    ...lines,
    tender: await readTenderBlock(tx, cfg, brandSaleId(saleId), sale.workingOrderId),
    ...(payments.length === 0 ? {} : { payments }),
    ...receiptQr(backend, filed?.verificationUrl),
  };
}
