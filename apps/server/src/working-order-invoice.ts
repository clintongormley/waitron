import "./errors.js";
import { recordSale } from "@waitron/core";
import type { RecipientIdentifierType } from "@waitron/country";
import {
  type Transaction,
  workingOrders,
  sales,
  type Database,
  withTransaction,
  billPayments,
} from "@waitron/db";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { requireNullableString, type Logger } from "@waitron/server-kit";
import { AppError, type SaleId, workingOrderId as brandWorkingOrderId } from "@waitron/shared";
import { eq, and } from "drizzle-orm";
import type { AdvanceCredit } from "./advance-deduction.js";
import {
  paidNoAdvance,
  advancesToTakeOff,
  readBillAdvances,
  refuseWhileAdvanceCorrectionOpen,
} from "./bill-advances.js";
import { type OrderEditAuthority, requireOrderBillEditor } from "./bill-editing.js";
import { linkBillCardPaymentsToSale } from "./bill-payments.js";
import {
  type InvoiceChoiceDeliveryContext,
  checkedInvoiceChoiceDelivery,
  reserveStagedInvoiceDelivery,
} from "./invoice-choice-delivery.js";
import {
  checkedInvoiceRecipient,
  type OrderInvoiceChoice,
  readOrderInvoiceChoice,
  selectOrderInvoice,
} from "./invoice-selection.js";
import { issuancePass } from "./issuance-pass.js";
import type { IssueMoment } from "./issue-moment.js";
import { linkSaleDishes } from "./order-portions.js";
import { saleReceiptFacts } from "./receipt-guests.js";
import { withReceiptListPrices } from "./receipt-lines.js";
import { readReceiptOrder } from "./receipt-order.js";
import { resolveInvoicePrinter } from "./receipt-print.js";
import { issueOrderMoment } from "./sale-day.js";
import { readSaleOperationDescription } from "./sale-operation-description.js";
import {
  type OrderLineIdentity,
  type GrossOrder,
  priceStoredOrderForIssuance,
} from "./stored-order-lines.js";
import { refusePlacedPaymentInFlight } from "./till-sale.js";
import { type TradingAdmission, requireEconomicWrite } from "./trading-admission.js";
import type { OriginConfig, TradingContext, SaleOriginConfig } from "./trading-context.js";
import { readOfferedReceiptLanguages, saleLanguageFor } from "./venue-locale.js";
import { type OrderAttendance, captureOrderEdit } from "./working-order-context.js";
import { refusePaymentInFlight, refusePendingPartPayment } from "./working-order-edit-state.js";

export interface InvoiceChoiceRequest extends OrderEditAuthority {
  revision: number;
  invoiceType: "F1" | "F2";
  delivery?: unknown;
  recipient: {
    identifierType?: RecipientIdentifierType;
    identifierCountryCode?: string;
    taxId: string;
    legalName: string;
    address: string;
    countryCode: string;
  } | null;
}

export async function refuseUnavailableFullInvoice(
  tx: Transaction,
  orderId: string,
): Promise<void> {
  const [choice] = await tx
    .select({ invoiceType: workingOrders.invoiceType })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  if (choice?.invoiceType === "F1") {
    throw new AppError("sale.full_invoice_unavailable", {});
  }
}
/**
 * The order whose recorded choices (invoice type, receipt language) may still change: open, or
 * placed with no sale yet, at the revision the caller read, with no payment in flight. A placed
 * order holding a sale refuses an invoice-type change as `invoice.choice_locked`.
 */
async function readChoiceChangeableOrder(
  tx: Transaction,
  orderId: string,
  expectedRevision: number,
  choice: "invoice" | "receipt-language",
) {
  const [order] = await tx
    .select({
      status: workingOrders.status,
      revision: workingOrders.revision,
      invoiceType: workingOrders.invoiceType,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  if (order === undefined || (order.status !== "open" && order.status !== "placed")) {
    throw new AppError("working_order.not_open", { workingOrderId: orderId });
  }
  if (order.status === "placed") {
    const [issued] = await tx
      .select({ id: sales.id })
      .from(sales)
      .where(eq(sales.workingOrderId, orderId))
      .limit(1);
    if (issued !== undefined) {
      if (choice === "invoice") throw new AppError("invoice.choice_locked", {});
      throw new AppError("working_order.not_open", { workingOrderId: orderId });
    }
  }
  if (order.revision !== expectedRevision) {
    throw new AppError("working_order.out_of_date", {
      workingOrderId: orderId,
      revision: order.revision,
    });
  }
  await refusePaymentInFlight(tx, [orderId]);
  if (order.status === "placed") {
    await refusePendingPartPayment(tx, [orderId], "any");
    await refusePlacedPaymentInFlight(tx, [orderId]);
  }
  return order;
}

export async function setOrderInvoiceChoice(
  db: Database,
  backend: Pick<FiscalBackend, "recipientNameMaxLength">,
  cfg: Partial<Pick<OriginConfig, "origin">>,
  orderId: string,
  request: InvoiceChoiceRequest,
  deliveryContext?: InvoiceChoiceDeliveryContext,
  attendance?: OrderAttendance & { personId: string },
): Promise<number> {
  if (request.invoiceType !== "F1" && request.invoiceType !== "F2") {
    throw new AppError("management.request_invalid", { field: "invoiceType" });
  }
  const recipient = request.recipient;
  let normalizedRecipient: InvoiceChoiceRequest["recipient"] = null;
  if (request.invoiceType === "F1") {
    normalizedRecipient = checkedInvoiceRecipient(backend, recipient);
  }
  if (request.invoiceType === "F2" && recipient !== null) {
    throw new AppError("management.request_invalid", { field: "recipient" });
  }
  return withTransaction(db, async (tx) => {
    const order = await readChoiceChangeableOrder(tx, orderId, request.revision, "invoice");
    await requireOrderBillEditor(tx, orderId, request);
    if (order.invoiceType === "F1" && request.invoiceType === "F2") {
      // An advance's money is on its own ticket, so it does not hold the rest to a full invoice.
      const [paid] = await tx
        .select({ id: billPayments.id })
        .from(billPayments)
        .where(
          and(
            eq(billPayments.workingOrderId, orderId),
            eq(billPayments.state, "received"),
            paidNoAdvance,
          ),
        )
        .limit(1);
      if (paid !== undefined) throw new AppError("invoice.choice_locked", {});
    }
    const invoiceDelivery = await checkedInvoiceChoiceDelivery(tx, {
      delivery: request.delivery,
      invoiceType: request.invoiceType,
      source: { kind: "order", orderId },
      context: deliveryContext,
      invoicePrinter: async () =>
        cfg.origin === undefined ? undefined : resolveInvoicePrinter(tx, cfg.origin),
    });
    const revision = order.revision + 1;
    await tx
      .update(workingOrders)
      .set({
        invoiceDelivery,
        invoiceType: request.invoiceType,
        recipientTaxId: normalizedRecipient?.taxId ?? null,
        recipientLegalName: normalizedRecipient?.legalName ?? null,
        recipientAddress: normalizedRecipient?.address ?? null,
        recipientCountryCode: normalizedRecipient?.countryCode ?? null,
        recipientIdentifierType: normalizedRecipient?.identifierType ?? null,
        recipientIdentifierCountryCode: normalizedRecipient?.identifierCountryCode ?? null,
        revision,
      })
      .where(eq(workingOrders.id, orderId));
    await captureOrderEdit(
      tx,
      attendance,
      orderId,
      attendance?.personId,
      revision,
      "invoice-choice",
    );
    return revision;
  });
}

export async function setOrderReceiptLanguage(
  db: Database,
  orderId: string,
  request: OrderEditAuthority & { revision: number; language: unknown },
  attendance?: OrderAttendance & { personId: string },
): Promise<number> {
  const language = requireNullableString(request.language, "language");
  return withTransaction(db, async (tx) => {
    const order = await readChoiceChangeableOrder(
      tx,
      orderId,
      request.revision,
      "receipt-language",
    );
    await requireOrderBillEditor(tx, orderId, request);
    if (language !== null && !(await readOfferedReceiptLanguages(tx)).includes(language)) {
      throw new AppError("management.request_invalid", { field: "language" });
    }
    const revision = order.revision + 1;
    await tx
      .update(workingOrders)
      .set({ receiptLocale: language, revision })
      .where(eq(workingOrders.id, orderId));
    await captureOrderEdit(
      tx,
      attendance,
      orderId,
      attendance?.personId,
      revision,
      "receipt-language",
    );
    return revision;
  });
}
/** An order's invoice priced from its stored lines. */
export interface PricedInvoice extends IssueMoment {
  id: string;
  /** The working-order line each of `priced.lines` was priced from. */
  identities: OrderLineIdentity[];
  /** The languages the invoice is filed in (`saleLanguageFor`). */
  language: { locale: string; invoiceLocales: string[] };
  /** The order's invoice choice, read as the invoice was priced; absent for an unknown order. */
  choice: OrderInvoiceChoice | undefined;
}
/**
 * Price order `id`'s invoice from its stored lines `order` at one clock reading, in the languages
 * its saved `receiptLocale` files it in, with its bill's advances `credits` taken off, dated by
 * {@link issueOrderMoment} with `mealEndedAt`. Writes nothing but `log`'s lines.
 */
export async function priceOrderInvoice(
  tx: Transaction,
  clock: TrustedClock,
  backend: FiscalBackend,
  cfg: TradingContext,
  id: string,
  order: GrossOrder,
  saved: { receiptLocale: string | null; credits: readonly AdvanceCredit[] | undefined },
  log?: Logger,
  mealEndedAt?: string,
): Promise<Omit<PricedInvoice, "choice">> {
  const language = await saleLanguageFor(tx, saved.receiptLocale ?? undefined, {
    log,
    workingOrderId: id,
  });
  return {
    id,
    identities: order.identities,
    language,
    ...(await issueOrderMoment(
      tx,
      cfg,
      { clock, backend },
      id,
      await issuancePass(tx, id, order),
      mealEndedAt,
      advancesToTakeOff(saved.credits, language.invoiceLocales),
    )),
  };
}
/** The lines a {@link PricedInvoice} files: its priced lines, then one per advance it takes off. */
export function filedLines(
  invoice: Pick<PricedInvoice, "priced" | "identities" | "deductionLines">,
) {
  return [
    ...withReceiptListPrices(invoice.priced.lines, invoice.identities),
    ...invoice.deductionLines,
  ];
}
/** Price an order's invoice for {@link issueUnpaidInvoice}, dated by {@link issueOrderMoment} and
 * refused while one of its advances has a correction open. Writes nothing but `log`'s lines. */
export async function priceForIssuance(
  tx: Transaction,
  clock: TrustedClock,
  backend: FiscalBackend,
  cfg: TradingContext,
  id: string,
  log?: Logger,
): Promise<PricedInvoice> {
  const order = await priceStoredOrderForIssuance(tx, id);
  const choice = await readOrderInvoiceChoice(tx, id);
  const { credits } = await readBillAdvances(tx, [id]);
  if (credits.has(id)) await refuseWhileAdvanceCorrectionOpen(tx, id);
  return {
    ...(await priceOrderInvoice(
      tx,
      clock,
      backend,
      cfg,
      id,
      order,
      { receiptLocale: choice?.receiptLocale ?? null, credits: credits.get(id) },
      log,
    )),
    choice,
  };
}
/** An invoice {@link issueUnpaidInvoice} filed, and the order fields its receipt prints. */
export interface IssuedInvoice {
  saleId: SaleId;
  /** The language the invoice was filed in. */
  locale: string;
  fiscal: Awaited<ReturnType<typeof recordSale>>["fiscal"];
  orderLabel: string | null;
  orderNumber: number;
}
/**
 * File the priced invoice without taking payment. On an order still open, save the label it was
 * issued under. A placed order's label can change
 * only in the update that moves it to settled or abandoned (`working_orders_enforce_transition`).
 */
export async function issueUnpaidInvoice(
  tx: Transaction,
  backend: FiscalBackend,
  cfg: SaleOriginConfig,
  invoice: PricedInvoice,
  operatorId: string,
  admission: TradingAdmission,
): Promise<IssuedInvoice> {
  await requireEconomicWrite(tx, cfg, admission);
  const { id, priced, meal, clock, operationDate, language } = invoice;
  await backend.refuseNewIssuance(tx, cfg.nodeId);
  const selected = await selectOrderInvoice(tx, backend, cfg, id, meal.total, invoice.choice);
  const operationDescription = await readSaleOperationDescription(tx, cfg, {
    kind: "order",
    orderId: id,
  });
  const { saleId, fiscal } = await recordSale(tx, backend, {
    receipt: await saleReceiptFacts(tx, id, selected.sale.counterparty, undefined),
    origin: cfg.origin,
    nodeId: cfg.nodeId,
    ...selected.sale,
    operationDescription,
    workingOrderId: brandWorkingOrderId(id),
    ...language,
    total: priced.total,
    lines: filedLines(invoice),
    vatBreakdown: priced.vatBreakdown,
    clock,
    operationDate,
    operatorId,
    settlement: { kind: "deferred" },
  });
  await linkSaleDishes(tx, saleId, invoice.identities);
  await linkBillCardPaymentsToSale(tx, id, saleId);
  const order = await readReceiptOrder(tx, id, { atIssuance: true });
  await tx
    .update(workingOrders)
    .set({ label: order.orderLabel })
    .where(and(eq(workingOrders.id, id), eq(workingOrders.status, "open")));
  await reserveStagedInvoiceDelivery(tx, saleId);
  return { saleId, fiscal, locale: language.locale, ...order };
}
