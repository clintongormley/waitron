import "./errors.js";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  billAdvances,
  billPayments,
  correctivesOf,
  invoiceCorrectionRefunds,
  invoiceCorrections,
  invoiceSeries,
  orderTableLabels,
  readLiveSeriesIdTx,
  sales,
  refunds,
  tenders,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { formatInvoiceNumber, recordSale, settleSale } from "@waitron/core";
import { prepareIssueClock, readIssueZone } from "@waitron/fiscal";
import { rateLines } from "@waitron/menu";
import { findPaymentByBillPayment, associatePaymentWithSale } from "@waitron/payments";
import { receiptLabelsFor } from "@waitron/country-packs";
import {
  ADVANCE_VAT_CLASS,
  AppError,
  addDecimal,
  centsToDecimal,
  decimal,
  localCalendarDate,
  rawCentsToDecimal,
  seriesId,
  timeZoneOffsetMinutes,
  type Decimal,
} from "@waitron/shared";
import type { AdvanceCredit, AdvanceGroup } from "./advance-deduction.js";
import { money } from "./bill-allocation.js";
import { pinnedAt, type IssueAdvances } from "./issue-moment.js";
import { saleReceiptFacts } from "./receipt-guests.js";
import { enqueueOriginalReceipt, type PrinterLookup } from "./receipt-print.js";
import { readReceiptOrder } from "./receipt-order.js";
import { readSaleOperationDescription } from "./sale-operation-description.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import { saleLanguageFor } from "./venue-locale.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import type { TillSaleDeps } from "./working-order.js";

type PaymentRow = typeof billPayments.$inferSelect;

/** The advance line's words in `language`: the bill's table, else its order number. */
function advanceLineText(language: string, table: string | null, orderNumber: number): string {
  const labels = receiptLabelsFor(language);
  return table === null || table === ""
    ? labels.paymentOnAccountForOrder.replace("{number}", () => String(orderNumber))
    : labels.paymentOnAccountAtTable.replace("{table}", () => table);
}

/* What `@waitron/verifactu`'s `validate` refuses in `DescripcionOperacion`: more than 500 code
 * points (`DESCRIPCION_LENGTH`) or a control character XML forbids (`CONTROL_CHAR`); the
 * code-point edge cases in ./bill-advances.test.ts run that check over the filed record. */
const OPERATION_DESCRIPTION_MAX = 500;
// eslint-disable-next-line no-control-regex -- deliberately matching control characters
const CONTROL_CHARACTER = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

/**
 * The advance's operation description: its line's Spanish words, by the bill's order number where
 * the table's name would make AEAT's record check refuse them; empty where the regime takes none,
 * which `configured`, the table's invoice's own description, shows as empty.
 */
function advanceOperationDescription(
  configured: string,
  table: string | null,
  orderNumber: number,
): string {
  if (configured === "") return "";
  const words = advanceLineText("es-ES", table, orderNumber);
  return Array.from(words).length <= OPERATION_DESCRIPTION_MAX && !CONTROL_CHARACTER.test(words)
    ? words
    : advanceLineText("es-ES", null, orderNumber);
}

/**
 * The advance invoice of a received bill payment whose payer wants their own receipt: one line of
 * its applied money at {@link ADVANCE_VAT_CLASS} on the payment's local day, settled by one tender
 * carrying the payment's money and tip, linked to its bill in `bill_advances`, and queued on the
 * receipt printer `printers` resolves; it emails nothing (advances plan, ruling L11).
 */
export async function issueAdvance(
  tx: Transaction,
  deps: Pick<TillSaleDeps, "backend" | "clock" | "log">,
  cfg: DeviceRequestConfig,
  payment: PaymentRow,
  printers: PrinterLookup,
): Promise<{ saleId: string }> {
  const workingOrderId = payment.workingOrderId;
  const applied = centsToDecimal(payment.applied);
  const tip = centsToDecimal(payment.tip);
  const receivedAt = new Date(payment.receivedAt!);

  const clock = await prepareIssueClock(tx, cfg, deps.clock);
  const reading = clock.now();
  deps.backend.assertRecordableAt(reading);
  const zone = await readIssueZone(tx, cfg);
  const paidOn = localCalendarDate(receivedAt, timeZoneOffsetMinutes(zone, receivedAt));

  const [order] = await tx
    .select({
      receiptLocale: workingOrders.receiptLocale,
      orderNumber: workingOrders.orderNumber,
      partyId: workingOrders.partyId,
      deliveryTableId: workingOrders.deliveryTableId,
      deliveryTableLabel: workingOrders.deliveryTableLabel,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  const language = await saleLanguageFor(tx, order!.receiptLocale ?? undefined, {
    log: deps.log,
    workingOrderId,
  });
  // A null label leaves only the bill's tables: a bill's own name is not a table.
  const table =
    (
      await orderTableLabels(tx, [
        {
          id: workingOrderId,
          partyId: order!.partyId,
          deliveryTableId: order!.deliveryTableId,
          deliveryTableLabel: order!.deliveryTableLabel,
          label: null,
        },
      ])
    ).get(workingOrderId) ?? null;
  const lineText = (locale: string) => advanceLineText(locale, table, order!.orderNumber);
  const priced = rateLines(
    {
      lines: [
        {
          lineNo: 1,
          name: lineText("en-GB"),
          descriptions: Object.fromEntries(
            language.invoiceLocales.map((locale) => [locale, lineText(locale)]),
          ),
          optionSnapshots: [],
          quantity: "1",
          category: null,
          unitName: null,
          unitPrecision: null,
          parentLineNo: null,
          variantName: null,
          variantDescriptions: null,
          variantKitchenName: null,
          kitchenName: null,
          advanceRole: "payment_on_account",
          vatClass: ADVANCE_VAT_CLASS,
          grossUnitPrice: applied,
          lineGross: applied,
        },
      ],
      total: applied,
    },
    paidOn,
  );

  const { saleId } = await recordSale(tx, deps.backend, {
    receipt: await saleReceiptFacts(tx, workingOrderId, null, null),
    origin: cfg.origin,
    nodeId: cfg.nodeId,
    seriesId: seriesId(await readLiveSeriesIdTx(tx, cfg.nodeId, "standard")),
    counterparty: null,
    recipientAddress: null,
    // Read for its refusals too: an advance is refused where the table's invoice would be.
    operationDescription: advanceOperationDescription(
      await readSaleOperationDescription(tx, cfg, { kind: "order", orderId: workingOrderId }),
      table,
      order!.orderNumber,
    ),
    ...language,
    total: priced.total,
    lines: priced.lines,
    vatBreakdown: priced.vatBreakdown,
    clock: pinnedAt(clock, reading),
    operatorId: payment.requestedBy,
    settlement: { kind: "deferred" },
  });
  await settleSale(tx, {
    saleId,
    tenders: [
      {
        method: payment.method,
        amount: money(addDecimal(applied, tip)),
        tipAmount: money(tip),
        cashTendered: payment.tendered === null ? null : centsToDecimal(payment.tendered),
        settledAt: receivedAt,
        billPaymentId: payment.id,
      },
    ],
  });
  const { orderLabel } = await readReceiptOrder(tx, workingOrderId, { atIssuance: true });
  await tx
    .insert(billAdvances)
    .values({ workingOrderId, advanceSaleId: saleId, billPaymentId: payment.id, orderLabel });
  if (payment.method === "card") {
    const card = await findPaymentByBillPayment(tx, payment.id);
    if (card !== undefined)
      await associatePaymentWithSale(tx, {
        provider: card.provider,
        paymentRef: card.paymentRef,
        saleId,
      });
  }
  // Built as Find a bill's copy is, so a duplicate prints what the original printed.
  const ticket = await readTransactionReceipt(deps.backend, tx, cfg, saleId);
  await enqueueOriginalReceipt(tx, cfg, ticket, saleId, {
    printers,
    personId: payment.requestedBy,
  });
  return { saleId };
}

/**
 * True for a `bill_payments` row of the query that paid no advance, whose money is on its bill
 * rather than on an advance's own ticket. `${billPayments}.id` renders table-qualified, so the
 * subquery's own table cannot capture a bare `"id"`.
 */
export const paidNoAdvance = sql`not exists (select 1 from ${billAdvances} where ${billAdvances.billPaymentId} = ${billPayments}.id)`;

/** An advance's own ticket, as printed: its number, local issue day, total and VAT breakdown. */
export interface AdvanceTicket {
  invoiceNumber: string;
  issuedOn: string;
  total: Decimal;
  vatBreakdown: (typeof sales.$inferSelect)["vatBreakdown"];
}

/** What the bill payment that paid an advance holds on its bill. */
export interface AdvancePaymentMoney {
  /** The advance's own sale. */
  saleId: string;
  ticket: AdvanceTicket;
  /** What is left of its advance: the advance's total plus its correctives. */
  left: Decimal;
  /** How many correctives its advance has. */
  correctives: number;
  /** The tips, in cents, of the completed `refunds` against its tender on the advance. */
  tipGivenBack: number;
  /** The applied amounts, in cents, of those refunds that are no leg of a Correct invoice: what
   * Refund a payment gave back, which `left` does not count. */
  givenBack: number;
}

/** The named bills' advances, each with its correctives (`correctivesOf`) included, oldest first
 * (a bill with none is absent from `credits`), and by the bill payment that paid each. */
export interface BillAdvances {
  credits: Map<string, AdvanceCredit[]>;
  payments: Map<string, AdvancePaymentMoney>;
}

/** {@link BillAdvances} of these bills. */
export async function readBillAdvances(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<BillAdvances> {
  const credits = new Map<string, AdvanceCredit[]>();
  const payments = new Map<string, AdvancePaymentMoney>();
  if (workingOrderIds.length === 0) return { credits, payments };
  const advances = await tx
    .select({
      workingOrderId: billAdvances.workingOrderId,
      billPaymentId: billAdvances.billPaymentId,
      saleId: sales.id,
      code: invoiceSeries.code,
      number: sales.invoiceNumber,
      issuedAt: sales.issuedAt,
      issuedOffsetMinutes: sales.issuedOffsetMinutes,
      total: sales.total,
      vatBreakdown: sales.vatBreakdown,
    })
    .from(billAdvances)
    .innerJoin(sales, eq(sales.id, billAdvances.advanceSaleId))
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(inArray(billAdvances.workingOrderId, [...workingOrderIds]))
    .orderBy(sales.issuedAt, sales.invoiceNumber);
  if (advances.length === 0) return { credits, payments };
  const saleIds = sql.join(
    advances.map((advance) => sql`${advance.saleId}`),
    sql`, `,
  );
  const { rows: correctives } = await tx.execute<{
    advance_id: string;
    total: string;
    vat_breakdown: string;
  }>(sql`select a.id as advance_id, cast(c.total as text) as total, c.vat_breakdown
    from sales a join sales c on ${correctivesOf(sql`c`, sql`a.id`)}
    where a.id in (${saleIds})`);
  const tipsGivenBack = await tx
    .select({
      billPaymentId: tenders.billPaymentId,
      tips: sql<number>`sum(${refunds.tipAmount})`.mapWith(Number),
      plain:
        sql<number>`sum(case when ${invoiceCorrectionRefunds.id} is null then ${refunds.appliedAmount} else 0 end)`.mapWith(
          Number,
        ),
    })
    .from(refunds)
    .innerJoin(tenders, eq(tenders.id, refunds.tenderId))
    .leftJoin(invoiceCorrectionRefunds, eq(invoiceCorrectionRefunds.tenderRefundId, refunds.id))
    .where(
      and(
        inArray(
          refunds.saleId,
          advances.map((advance) => advance.saleId),
        ),
        eq(refunds.state, "completed"),
        isNotNull(tenders.billPaymentId),
      ),
    )
    .groupBy(tenders.billPaymentId);

  for (const advance of advances) {
    const own = correctives.filter((row) => row.advance_id === advance.saleId);
    const groups = new Map<string, AdvanceGroup>();
    const breakdowns = [
      advance.vatBreakdown,
      ...own.map((row) => JSON.parse(row.vat_breakdown) as typeof advance.vatBreakdown),
    ];
    for (const breakdown of breakdowns)
      for (const line of breakdown) {
        const rate = decimal(line.rate);
        const key = money(rate);
        const seen = groups.get(key);
        groups.set(key, {
          rate,
          base: addDecimal(seen?.base ?? ZERO, decimal(line.base)),
          tax: addDecimal(seen?.tax ?? ZERO, decimal(line.tax)),
        });
      }
    const gross = own.reduce<Decimal>(
      (sum, row) => addDecimal(sum, rawCentsToDecimal(row.total)),
      centsToDecimal(advance.total),
    );
    const invoiceNumber = formatInvoiceNumber(advance.code, advance.number);
    const list = credits.get(advance.workingOrderId) ?? [];
    list.push({
      saleId: advance.saleId,
      invoiceNumber,
      issuedAt: advance.issuedAt,
      groups: [...groups.values()],
      gross,
    });
    credits.set(advance.workingOrderId, list);
    const givenBack = tipsGivenBack.find((row) => row.billPaymentId === advance.billPaymentId);
    payments.set(advance.billPaymentId, {
      saleId: advance.saleId,
      ticket: {
        invoiceNumber,
        issuedOn: localCalendarDate(new Date(advance.issuedAt), advance.issuedOffsetMinutes),
        total: centsToDecimal(advance.total),
        vatBreakdown: advance.vatBreakdown,
      },
      left: gross,
      correctives: own.length,
      tipGivenBack: givenBack?.tips ?? 0,
      givenBack: givenBack?.plain ?? 0,
    });
  }
  return { credits, payments };
}

/**
 * The first advance on the bill `workingOrderId` with a correction still open, which could yet file
 * a corrective on it after the bill's invoice took it off by its filed figures. A correction with
 * a refund pending stays open: Close refuses `invoice_correction.refund_pending`.
 */
export async function advanceWithOpenCorrection(
  tx: Transaction,
  workingOrderId: string,
): Promise<{ saleId: string; invoiceNumber: string } | undefined> {
  const [open] = await tx
    .select({ saleId: sales.id, code: invoiceSeries.code, number: sales.invoiceNumber })
    .from(billAdvances)
    .innerJoin(sales, eq(sales.id, billAdvances.advanceSaleId))
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .innerJoin(
      invoiceCorrections,
      and(eq(invoiceCorrections.originalSaleId, sales.id), eq(invoiceCorrections.state, "open")),
    )
    .where(eq(billAdvances.workingOrderId, workingOrderId))
    .orderBy(sales.issuedAt, sales.invoiceNumber)
    .limit(1);
  return open === undefined
    ? undefined
    : { saleId: open.saleId, invoiceNumber: formatInvoiceNumber(open.code, open.number) };
}

/** Refuses `advance.correction_open` while {@link advanceWithOpenCorrection} finds one. */
export async function refuseWhileAdvanceCorrectionOpen(
  tx: Transaction,
  workingOrderId: string,
): Promise<void> {
  const open = await advanceWithOpenCorrection(tx, workingOrderId);
  if (open !== undefined)
    throw new AppError("advance.correction_open", { workingOrderId, ...open });
}

/**
 * What the bill's invoice takes off: its advances `credits` as they stand, worded in `languages`,
 * the invoice languages `saleLanguageFor` files the invoice in.
 */
export function advancesToTakeOff(
  credits: readonly AdvanceCredit[] | undefined,
  languages: readonly string[],
): IssueAdvances {
  return { credits: credits ?? [], languages };
}

const ZERO = decimal("0.00");
