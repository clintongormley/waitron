import "./errors.js";
import { eq } from "drizzle-orm";
import {
  invoiceSeries,
  nodes,
  readTenant,
  sales,
  saleLines,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { formatInvoiceNumber } from "@waitron/core";
import type { FiscalBackend } from "@waitron/fiscal";
import {
  AppError,
  centsToDecimal,
  locationId,
  saleId as brandSaleId,
  thousandthsToDecimal,
  receiptLogoSource,
  resolveReceiptTrim,
} from "@waitron/shared";
import { getPrintedReceipt } from "@waitron/layouts";
import { readReceiptLanguage } from "@waitron/catalogue";
import type { TillConfig } from "./till-config.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";
import { receiptLines } from "./receipt-adjustments.js";
import { readReceiptOrder } from "./receipt-order.js";
import { readBillTenderLines, readTenderBlock, receiptQr } from "./till-sale.js";
import { VENUE_SERVICE } from "./modules.js";

export async function readInvoiceDocument(
  backend: FiscalBackend,
  tx: Transaction,
  cfg: TillConfig,
  saleId: string,
): Promise<ReceiptDocumentInput> {
  const [issued] = await tx
    .select({ sale: sales, code: invoiceSeries.code, locationId: nodes.locationId })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .innerJoin(nodes, eq(nodes.id, sales.nodeId))
    .where(eq(sales.id, saleId));
  if (issued === undefined) throw new AppError("invoice_delivery.not_found", {});
  const { sale } = issued;
  if (sale.counterpartyTaxId === null)
    throw new AppError("invoice_delivery.full_invoice_required", {});
  const saleCfg = { ...cfg, locationId: locationId(issued.locationId) };
  const rows = await tx
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(saleLines.lineNo);
  const byId = new Map(rows.map((row) => [row.id, row.lineNo]));
  const orderLines =
    sale.workingOrderId === null
      ? []
      : await tx
          .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, sale.workingOrderId));
  const orderIds = new Map(orderLines.map((row) => [row.lineNo, row.id]));
  // Draft ids locate saved adjustments; names and price figures come from sale snapshots.
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
        lineGross: centsToDecimal(row.lineGross ?? row.lineTotal),
        parentLineNo: row.parentLineId === null ? null : byId.get(row.parentLineId),
      })),
    },
    rows.map((row) => ({ id: orderIds.get(row.lineNo) ?? row.id, listUnitGross: null })),
    saleId,
  );
  const filed = await backend.filedReceiptFor(tx, brandSaleId(saleId));
  const taxpayer = filed?.issuer === undefined ? await readTenant(tx) : null;
  if (filed?.issuer === undefined && taxpayer === null) throw new Error("Invoice has no taxpayer");
  const issuer = {
    venueName: filed?.issuer?.legalName ?? taxpayer!.legalName,
    nif: filed?.issuer?.taxId ?? taxpayer!.taxId,
    ...(sale.taxpayerDomicile === null ? {} : { domicile: sale.taxpayerDomicile }),
  };
  const diagnostic = (event: {
    operation: string;
    code: string;
    receiptId?: 1;
    departmentId?: string;
  }) => console.warn("receipt.optional_read_failed", event);
  const venue = await getPrintedReceipt(tx, "80mm", diagnostic);
  const header = await VENUE_SERVICE.readSaleReceiptHeader(tx, saleId);
  const current = await readReceiptLanguage(tx, saleCfg.locationId);
  const department =
    header?.departmentId == null
      ? null
      : await VENUE_SERVICE.readPrintedDepartmentReceipt(
          tx,
          {
            ...saleCfg,
            receiptLanguages: [...new Set([sale.locale, current.locale])],
            receiptDiagnostic: diagnostic,
          },
          header.departmentId,
          "80mm",
        );
  const authored = department?.receipt ?? null;
  const receipt = resolveReceiptTrim(authored, venue.receipt, sale.locale, current.locale);
  const logo =
    receiptLogoSource(authored, venue.receipt) === "department" ? department!.logo : venue.logo;
  const payments = await readBillTenderLines(tx, brandSaleId(saleId));
  const issueDay = new Date(new Date(sale.issuedAt).getTime() + sale.issuedOffsetMinutes * 60_000)
    .toISOString()
    .slice(0, 10);
  return {
    surface: "a4",
    issuer,
    receipt,
    logo,
    receiptHeader: header?.departmentId == null ? undefined : header,
    venueAddress: [],
    invoiceLocale: sale.locale,
    namesLocale: sale.locale,
    simulated: cfg.practiceMode,
    result: {
      ...(sale.workingOrderId === null
        ? { orderLabel: null, orderNumber: 0 }
        : await readReceiptOrder(tx, saleCfg, sale.workingOrderId)),
      invoiceType: "F1",
      issuer,
      recipient: {
        taxId: sale.counterpartyTaxId,
        legalName: sale.counterpartyLegalName!,
        countryCode: sale.counterpartyCountryCode!,
        address: sale.counterpartyAddress!,
      },
      locale: sale.locale,
      invoiceNumber: formatInvoiceNumber(issued.code, sale.invoiceNumber),
      issuedAt: new Date(sale.issuedAt).toISOString(),
      issuedOffsetMinutes: sale.issuedOffsetMinutes,
      ...(sale.operationDate !== null && sale.operationDate !== issueDay
        ? { operationDate: sale.operationDate }
        : {}),
      total: centsToDecimal(sale.total),
      vatBreakdown: sale.vatBreakdown,
      ...lines,
      tender: await readTenderBlock(tx, saleCfg, brandSaleId(saleId), sale.workingOrderId),
      ...(payments.length === 0 ? {} : { payments }),
      ...receiptQr(backend, filed?.verificationUrl),
    },
  };
}
