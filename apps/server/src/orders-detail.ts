import { formatInvoiceNumber } from "@waitron/core";
import type { RecipientIdentifierType } from "@waitron/country";
import {
  type Transaction,
  persons,
  printers,
  invoicePdfDownloads,
  workingOrderLines,
  saleLines,
  sales,
  invoiceSeries,
  correctivesOf,
  saleSubstitutions,
  tenders,
  billPayments,
  refunds as refundRows,
  parties,
  unpaidDepartures,
  receiptReprints,
  printJobs,
  isReceiptPrinter,
} from "@waitron/db";
import {
  type Decimal,
  AppError,
  thousandthsToDecimal,
  centsToDecimal,
  type OptionSnapshot,
  optionSnapshotNames,
} from "@waitron/shared";
import { inArray, eq, desc, asc, sql, or, and } from "drizzle-orm";
import {
  type InvoiceDeliveryAttempt,
  type InvoiceDeliveryStatus,
  readInvoiceDeliveries,
  type PrinterOffer,
} from "./invoice-delivery-status.js";
import { canEmailInvoice } from "./invoice-email-contact.js";
import { storedRecipientIdentifier } from "./invoice-selection.js";
import type { LineNutrition } from "./line-nutrition.js";
import { VENUE_SERVICE } from "./modules.js";
import { type OrderRow, type OrderListFilter, listOrders } from "./orders-list.js";
import { optionAnswersKey } from "./receipt-lines.js";
import "./errors.js";

export interface OrderLine {
  sent: boolean;
  sentNutrition: LineNutrition | null;
  lineNo: number;
  name: string;
  variantName: string | null;
  quantity: Decimal;
  total: Decimal;
  listUnitPrice: Decimal | null;
  creditedTo: string | null;
}

export interface OrderInvoice {
  kind: "invoice" | "corrective" | "replacement" | "substitution";
  invoiceType?: "F1" | "F2";
  recipient?: {
    taxId: string;
    legalName: string;
    countryCode: string;
    address: string;
    identifierType?: RecipientIdentifierType;
    identifierCountryCode?: string;
  };
  taxpayerDomicile?: string;
  number: string;
  issuedAt: string;
  total: Decimal;
  rungBy: string | null;
}

export interface OrderTender {
  method: string;
  amount: Decimal;
  tip: Decimal;
}

export interface OrderBillPayment {
  method: string;
  state: string;
  applied: Decimal;
  tip: Decimal;
  createdAt: string;
  refunds: { applied: Decimal; tip: Decimal; state: string; reason: string; createdAt: string }[];
}

export interface OrderParty {
  name: string | null;
  guestCount: number | null;
  openedAt: string;
  closedAt: string | null;
  openedBy: string | null;
  closedBy: string | null;
  tables: string[];
}

export interface OrderDeparture {
  recordedAt: string;
  reason: string;
  recordedBy: string | null;
  authorizedBy: string | null;
  amount: Decimal;
}

export interface OrderReprint {
  requestedAt: string;
  personId: string;
  personName: string | null;
  printerName: string;
}

export interface OrderDeliveryAttempt extends InvoiceDeliveryAttempt {
  personName: string | null;
}

export interface OrderDeliveries extends Omit<InvoiceDeliveryStatus, "current" | "history"> {
  current: OrderDeliveryAttempt | null;
  history: OrderDeliveryAttempt[];
}

export interface OrderInvoicePdfDownload {
  requestedAt: string;
  personId: string;
  personName: string | null;
}

export interface OrderDetail {
  row: OrderRow;
  lines: OrderLine[];
  invoices: OrderInvoice[];
  tenders: OrderTender[];
  payments: OrderBillPayment[];
  party: OrderParty | null;
  departure: OrderDeparture | null;
  reprints: OrderReprint[];
  /** Null unless the bill's invoice is a full invoice. */
  deliveries: OrderDeliveries | null;
  invoicePdfDownloads: OrderInvoicePdfDownload[];
}

export async function readVisibleOrder(
  tx: Transaction,
  id: string,
  scope: OrderListFilter["scope"],
): Promise<OrderRow> {
  const { rows } = await listOrders(tx, {
    status: "all",
    dates: "any",
    credited: false,
    limit: 1,
    only: id,
    scope,
  });
  const row = rows[0];
  if (row === undefined) throw new AppError("working_order.not_found", { workingOrderId: id });
  return row;
}

export async function readOrderDetail(
  tx: Transaction,
  id: string,
  scope: OrderListFilter["scope"],
  emailTransport: boolean,
  includeInvoiceRecipientEmail = false,
): Promise<OrderDetail> {
  const row = await readVisibleOrder(tx, id, scope);
  return {
    row,
    lines: row.kind === "bill" ? await readBillLines(tx, id) : await readSaleLines(tx, id),
    invoices: row.saleId === null ? [] : await readInvoices(tx, row.saleId),
    tenders: row.saleId === null ? [] : await readTenders(tx, row.saleId),
    payments: row.kind === "bill" ? await readBillPayments(tx, id) : [],
    party: row.partyId === null ? null : await readParty(tx, row.partyId, row.tables),
    departure: row.kind === "bill" ? await readDeparture(tx, id) : null,
    reprints: row.saleId === null ? [] : await readReprints(tx, row.saleId),
    deliveries:
      row.saleId === null
        ? null
        : await readDeliveries(tx, row.saleId, emailTransport, includeInvoiceRecipientEmail),
    invoicePdfDownloads: row.saleId === null ? [] : await readPdfDownloads(tx, row.saleId),
  };
}

async function readDeliveries(
  tx: Transaction,
  saleId: string,
  emailTransport: boolean,
  includeInvoiceRecipientEmail: boolean,
): Promise<OrderDeliveries | null> {
  const status = await readInvoiceDeliveries(tx, saleId, {
    emailAvailable: (sale) =>
      canEmailInvoice(tx, { kind: "sale", saleId: sale.id }, emailTransport),
    includeInvoiceRecipientEmail,
    printers: orderInvoicePrinters(tx),
  });
  if (status === null) return null;
  const ids = [...new Set(status.history.flatMap((attempt) => attempt.personId ?? []))];
  const names =
    ids.length === 0
      ? []
      : await tx
          .select({ id: persons.id, name: persons.displayName })
          .from(persons)
          .where(inArray(persons.id, ids));
  const named = (attempt: InvoiceDeliveryAttempt): OrderDeliveryAttempt => ({
    ...attempt,
    personName: names.find((person) => person.id === attempt.personId)?.name ?? null,
  });
  return {
    ...status,
    current: status.current === null ? null : named(status.current),
    history: status.history.map(named),
  };
}

export function orderInvoicePrinters(tx: Transaction): PrinterOffer {
  return async () => {
    // An invoice can go to either kind. Keep receipt printers ahead of A4 printers.
    return tx
      .select({ id: printers.id, name: printers.name, kind: printers.kind })
      .from(printers)
      .where(eq(printers.active, true))
      .orderBy(desc(printers.kind), asc(printers.name), asc(printers.id));
  };
}

async function readPdfDownloads(
  tx: Transaction,
  saleId: string,
): Promise<OrderInvoicePdfDownload[]> {
  return tx
    .select({
      requestedAt: invoicePdfDownloads.requestedAt,
      personId: invoicePdfDownloads.personId,
      personName: persons.displayName,
    })
    .from(invoicePdfDownloads)
    .leftJoin(persons, eq(persons.id, invoicePdfDownloads.personId))
    .where(eq(invoicePdfDownloads.saleId, saleId))
    .orderBy(invoicePdfDownloads.requestedAt, sql`${invoicePdfDownloads}.rowid`);
}

async function readBillLines(tx: Transaction, billId: string): Promise<OrderLine[]> {
  const stored = await tx
    .select({
      id: workingOrderLines.id,

      parentLineId: workingOrderLines.parentLineId,
      optionSnapshots: workingOrderLines.optionSnapshots,
      note: workingOrderLines.note,
      unitPriceGross: workingOrderLines.unitPriceGross,
      courseId: workingOrderLines.courseId,
      sentAt: workingOrderLines.sentAt,
      servedAt: workingOrderLines.servedAt,
      servedQuantity: workingOrderLines.servedQuantity,
      wholePortion: workingOrderLines.wholePortion,
      lineNo: workingOrderLines.lineNo,
      name: workingOrderLines.name,
      variantName: workingOrderLines.variantName,
      quantity: workingOrderLines.quantity,
      total: workingOrderLines.lineTotal,
      listUnitPrice: workingOrderLines.listUnitPriceGross,
      creditedTo: workingOrderLines.creditedTo,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(workingOrderLines.lineNo);
  const saved = await VENUE_SERVICE.readSentLineNutrition(
    tx,
    stored.map((line) => line.id),
  );
  const lines = stored.map((line) => ({
    ...line,
    measured: line.wholePortion === null ? null : !line.wholePortion,
    sentNutrition: saved.get(line.id) ?? null,
  }));
  return foldIdenticalPortions(lines).map((line) => ({
    sentNutrition: line.sentNutrition,
    sent: line.sentAt !== null,
    lineNo: line.lineNo,
    name: line.name,
    variantName: line.variantName,
    quantity: thousandthsToDecimal(line.quantity),
    total: centsToDecimal(line.total),
    listUnitPrice: line.listUnitPrice === null ? null : centsToDecimal(line.listUnitPrice),
    creditedTo: line.creditedTo,
  }));
}
interface StoredBillLine {
  sentNutrition: LineNutrition | null;
  id: string;
  parentLineId: string | null;
  name: string;
  variantName: string | null;
  optionSnapshots: OptionSnapshot[];
  note: string | null;
  unitPriceGross: number;
  courseId: string | null;
  sentAt: string | null;
  servedAt: string | null;
  servedQuantity: number;
  /** Of the line's portion; null on an extra and on a dish bound to none. */
  measured: boolean | null;
  listUnitPrice: number | null;
  creditedTo: string | null;
  quantity: number;
  total: number;
}
/**
 * `lines` (in line order) with each dish bound to a whole portion folded into an earlier one in the
 * same course and kitchen state that the order detail shows the same, extras included: into its
 * row and its extras' rows, quantities and amounts summed. Other lines stay as stored.
 */
function foldIdenticalPortions<L extends StoredBillLine>(lines: readonly L[]): L[] {
  const out = lines.map((line) => ({ ...line }));
  const extrasOf = new Map<string, L[]>();
  for (const line of out) {
    if (line.parentLineId === null) continue;
    extrasOf.set(line.parentLineId, [...(extrasOf.get(line.parentLineId) ?? []), line]);
  }
  const looks = (line: L) =>
    JSON.stringify([
      line.name,
      line.variantName,
      optionAnswersKey(line.optionSnapshots.map(optionSnapshotNames)),
      line.note,
      line.unitPriceGross,
      line.listUnitPrice,
      line.creditedTo,
      line.courseId,
      line.sentAt !== null,
      line.servedAt !== null,
      line.servedQuantity,
      line.sentNutrition === null
        ? null
        : [
            line.sentNutrition.allergens === null
              ? null
              : Object.keys(line.sentNutrition.allergens)
                  .sort()
                  .map((code) => [
                    code,
                    [...new Set(line.sentNutrition!.allergens![code]!.kinds ?? [])].sort(),
                  ]),
            [...new Set(line.sentNutrition.dietaryDeclarations)].sort(),
          ],
    ]);
  const byKey = new Map<string, { dish: L; extras: L[] }>();
  const folded = new Set<string>();
  for (const dish of out) {
    if (dish.parentLineId !== null || dish.measured !== false) continue;
    const extras = (extrasOf.get(dish.id) ?? [])
      .map((extra) => ({ extra, key: JSON.stringify([looks(extra), extra.quantity]) }))
      .sort((a, b) => (a.key < b.key ? -1 : 1));
    const key = JSON.stringify([looks(dish), extras.map((entry) => entry.key)]);
    const same = byKey.get(key);
    if (same === undefined) {
      byKey.set(key, { dish, extras: extras.map((entry) => entry.extra) });
      continue;
    }
    same.dish.quantity += dish.quantity;
    same.dish.total += dish.total;
    folded.add(dish.id);
    extras.forEach(({ extra }, at) => {
      const into = same.extras[at]!;
      into.quantity += extra.quantity;
      into.total += extra.total;
      folded.add(extra.id);
    });
  }
  return out.filter((line) => !folded.has(line.id));
}

async function readSaleLines(tx: Transaction, saleId: string): Promise<OrderLine[]> {
  const rows = await tx
    .select({
      lineNo: saleLines.lineNo,
      name: saleLines.name,
      variantName: saleLines.variantName,
      quantity: saleLines.quantity,
      total: saleLines.lineTotal,
      gross: saleLines.lineGross,
    })
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(saleLines.lineNo);
  return rows.map((line) => ({
    sentNutrition: null,
    sent: false,
    lineNo: line.lineNo,
    name: line.name,
    variantName: line.variantName,
    quantity: thousandthsToDecimal(line.quantity),
    total: centsToDecimal(line.gross ?? line.total),
    listUnitPrice: null,
    creditedTo: null,
  }));
}

async function readInvoices(tx: Transaction, saleId: string): Promise<OrderInvoice[]> {
  const base = await tx
    .select({
      id: sales.id,
      counterpartyTaxId: sales.counterpartyTaxId,
      identifierType: sales.counterpartyIdentifierType,
      identifierCountryCode: sales.counterpartyIdentifierCountryCode,
      counterpartyLegalName: sales.counterpartyLegalName,
      counterpartyCountryCode: sales.counterpartyCountryCode,
      counterpartyAddress: sales.counterpartyAddress,
      taxpayerDomicile: sales.taxpayerDomicile,
      number: sales.invoiceNumber,
      code: invoiceSeries.code,
      issuedAt: sales.issuedAt,
      total: sales.total,
      rungBy: persons.displayName,
    })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .leftJoin(persons, eq(persons.id, sales.operatorId))
    .where(eq(sales.id, saleId));
  const correctives = await tx
    .select({
      id: sales.id,
      number: sales.invoiceNumber,
      code: invoiceSeries.code,
      issuedAt: sales.issuedAt,
      total: sales.total,
      rungBy: persons.displayName,
      replacesOriginal: sales.replacesOriginal,
    })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .leftJoin(persons, eq(persons.id, sales.operatorId))
    .where(
      or(
        correctivesOf(sql`${sales}`, sql`${saleId}`),
        and(eq(sales.correctsSaleId, saleId), eq(sales.replacesOriginal, true)),
      ),
    )
    .orderBy(sales.issuedAt, sql`${sales}.rowid`);
  const replacements = correctives.filter((invoice) => invoice.replacesOriginal);
  const corrections = correctives.filter((invoice) => !invoice.replacesOriginal);
  const substitutes = await tx
    .select({
      id: sales.id,
      number: sales.invoiceNumber,
      code: invoiceSeries.code,
      issuedAt: sales.issuedAt,
      total: sales.total,
      rungBy: persons.displayName,
    })
    .from(saleSubstitutions)
    .innerJoin(sales, eq(sales.id, saleSubstitutions.substitutionSaleId))
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .leftJoin(persons, eq(persons.id, sales.operatorId))
    .where(eq(saleSubstitutions.substitutedSaleId, saleId))
    .orderBy(sales.issuedAt, sales.id);
  return [
    ...base.map((invoice): OrderInvoice => ({
      kind: "invoice",
      invoiceType: invoice.counterpartyTaxId === null ? "F2" : "F1",
      ...(invoice.counterpartyTaxId !== null && invoice.taxpayerDomicile !== null
        ? { taxpayerDomicile: invoice.taxpayerDomicile }
        : {}),
      ...(invoice.counterpartyTaxId !== null &&
      invoice.counterpartyLegalName !== null &&
      invoice.counterpartyCountryCode !== null &&
      invoice.counterpartyAddress !== null
        ? {
            recipient: {
              taxId: invoice.counterpartyTaxId,
              ...storedRecipientIdentifier(invoice.identifierType, invoice.identifierCountryCode),
              legalName: invoice.counterpartyLegalName,
              countryCode: invoice.counterpartyCountryCode,
              address: invoice.counterpartyAddress,
            },
          }
        : {}),
      number: formatInvoiceNumber(invoice.code, invoice.number),
      issuedAt: invoice.issuedAt,
      total: centsToDecimal(invoice.total),
      rungBy: invoice.rungBy,
    })),
    ...replacements.map((invoice): OrderInvoice => ({
      kind: "replacement",
      number: formatInvoiceNumber(invoice.code, invoice.number),
      issuedAt: invoice.issuedAt,
      total: centsToDecimal(invoice.total),
      rungBy: invoice.rungBy,
    })),
    ...corrections.map((invoice): OrderInvoice => ({
      kind: "corrective",
      number: formatInvoiceNumber(invoice.code, invoice.number),
      issuedAt: invoice.issuedAt,
      total: centsToDecimal(invoice.total),
      rungBy: invoice.rungBy,
    })),
    ...substitutes.map((invoice): OrderInvoice => ({
      kind: "substitution",
      number: formatInvoiceNumber(invoice.code, invoice.number),
      issuedAt: invoice.issuedAt,
      total: centsToDecimal(invoice.total),
      rungBy: invoice.rungBy,
    })),
  ];
}

async function readTenders(tx: Transaction, saleId: string): Promise<OrderTender[]> {
  const rows = await tx
    .select({ method: tenders.method, amount: tenders.amount, tip: tenders.tipAmount })
    .from(tenders)
    .where(eq(tenders.saleId, saleId))
    .orderBy(tenders.settledAt, sql`${tenders}.rowid`);
  return rows.map((tender) => ({
    method: tender.method,
    amount: centsToDecimal(tender.amount),
    tip: centsToDecimal(tender.tip),
  }));
}

async function readBillPayments(tx: Transaction, billId: string): Promise<OrderBillPayment[]> {
  const payments = await tx
    .select({
      id: billPayments.id,
      method: billPayments.method,
      state: billPayments.state,
      applied: billPayments.applied,
      tip: billPayments.tip,
      createdAt: billPayments.createdAt,
    })
    .from(billPayments)
    .where(eq(billPayments.workingOrderId, billId))
    .orderBy(billPayments.createdAt, sql`${billPayments}.rowid`);
  if (payments.length === 0) return [];
  const refunds = await tx
    .select({
      billPaymentId: refundRows.billPaymentId,
      applied: refundRows.appliedAmount,
      tip: refundRows.tipAmount,
      state: refundRows.state,
      reason: refundRows.reason,
      createdAt: refundRows.createdAt,
    })
    .from(refundRows)
    .where(
      inArray(
        refundRows.billPaymentId,
        payments.map((payment) => payment.id),
      ),
    )
    .orderBy(refundRows.createdAt, sql`${refundRows}.rowid`);
  return payments.map((payment) => ({
    method: payment.method,
    state: payment.state,
    applied: centsToDecimal(payment.applied),
    tip: centsToDecimal(payment.tip),
    createdAt: payment.createdAt,
    refunds: refunds
      .filter((refund) => refund.billPaymentId === payment.id)
      .map((refund) => ({
        applied: centsToDecimal(refund.applied),
        tip: centsToDecimal(refund.tip),
        state: refund.state,
        reason: refund.reason,
        createdAt: refund.createdAt,
      })),
  }));
}

async function readParty(
  tx: Transaction,
  partyId: string,
  tables: string[],
): Promise<OrderParty | null> {
  const [party] = await tx
    .select({
      name: parties.name,
      guestCount: parties.guestCount,
      openedAt: parties.openedAt,
      closedAt: parties.closedAt,
      openedBy: parties.openedBy,
      closedBy: parties.closedBy,
    })
    .from(parties)
    .where(eq(parties.id, partyId));
  if (party === undefined) return null;
  const ids = [party.openedBy, party.closedBy].filter((id): id is string => id !== null);
  const names =
    ids.length === 0
      ? []
      : await tx
          .select({ id: persons.id, name: persons.displayName })
          .from(persons)
          .where(inArray(persons.id, ids));
  const nameOf = (id: string | null) => names.find((person) => person.id === id)?.name ?? null;
  return {
    name: party.name,
    guestCount: party.guestCount,
    openedAt: party.openedAt,
    closedAt: party.closedAt,
    openedBy: nameOf(party.openedBy),
    closedBy: nameOf(party.closedBy),
    tables,
  };
}

async function readDeparture(tx: Transaction, billId: string): Promise<OrderDeparture | null> {
  const [departure] = await tx
    .select({
      recordedAt: unpaidDepartures.recordedAt,
      reason: unpaidDepartures.reason,
      recordedBy: unpaidDepartures.recordedBy,
      authorizedBy: unpaidDepartures.authorizedBy,
      amount: unpaidDepartures.amount,
    })
    .from(unpaidDepartures)
    .where(eq(unpaidDepartures.workingOrderId, billId));
  if (departure === undefined) return null;
  const names = await tx
    .select({ id: persons.id, name: persons.displayName })
    .from(persons)
    .where(inArray(persons.id, [departure.recordedBy, departure.authorizedBy]));
  const nameOf = (id: string) => names.find((person) => person.id === id)?.name ?? null;
  return {
    recordedAt: departure.recordedAt,
    reason: departure.reason,
    recordedBy: nameOf(departure.recordedBy),
    authorizedBy: nameOf(departure.authorizedBy),
    amount: centsToDecimal(departure.amount),
  };
}

async function readReprints(tx: Transaction, saleId: string): Promise<OrderReprint[]> {
  const rows = await tx
    .select({
      requestedAt: receiptReprints.requestedAt,
      personId: receiptReprints.personId,
      personName: persons.displayName,
      printerName: printers.name,
    })
    .from(receiptReprints)
    .innerJoin(printJobs, eq(printJobs.id, receiptReprints.printJobId))
    .innerJoin(printers, and(isReceiptPrinter(), eq(printers.id, printJobs.printerId)))
    .leftJoin(persons, eq(persons.id, receiptReprints.personId))
    .where(and(eq(receiptReprints.saleId, saleId), eq(printJobs.receiptCopy, true)))
    .orderBy(receiptReprints.requestedAt, sql`${receiptReprints}.rowid`);
  return rows;
}
