import { and, eq, exists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { createHash } from "node:crypto";
import {
  correctivesOf,
  dailyCloses,
  saleSettlements,
  saleSubstitutions,
  saleVoids,
  sales,
  tenders,
  deferredClosures,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { prepareIssueClock } from "@waitron/fiscal";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { resolveVenueClock } from "@waitron/reporting";
import { AppError, businessDayAt, centsToDecimal, decimal, decimalToCents } from "@waitron/shared";
import type { Decimal, ErrorParams, SaleId } from "@waitron/shared";
import { captureKitchenActivity, type AttendanceRecorder } from "./attendance-capture.js";
import { invalid } from "./bill-allocation.js";
import { billsHoldingMoney } from "./bill-payments.js";
import { checkedInvoiceRecipient, storedRecipientIdentifier } from "./invoice-selection.js";
import { requireOrderBillEditor } from "./bill-editing.js";
import { assertBillHasNoUnsent } from "./bill-unsent.js";
import { refuseForDiskStop, type DiskFullState } from "./disk-full-state.js";
import { finishPartyService, readPartyFinishReadiness } from "./finish-party-service.js";
import { pinnedAt } from "./issue-moment.js";
import type { Logger } from "./logger.js";
import {
  billInvoiceDelivery,
  canonicalJson,
  partyFamily,
  readFamilyBills,
  type BillInvoiceDelivery,
} from "./parties.js";
import { readReceiptOrder } from "./receipt-order.js";
import { refusePlacedPaymentInFlight, settleIssuedOrder } from "./till-sale.js";
import { requireEconomicWrite, type TradingAdmission } from "./trading-admission.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import type { CloseDeferredRequest, CloseDeferredResult } from "./deferred-close-types.js";
import type { BillEditExpected } from "./order-drafts.js";
import { saleLanguageFor } from "./venue-locale.js";
import {
  issueUnpaidInvoice,
  markOrderPlaced,
  type PricedInvoice,
  priceForIssuance,
  readInvoiceNumbers,
  refusePaymentInFlight,
  refuseUnavailableFullInvoice,
} from "./working-order.js";
import "./errors.js";

export interface DeferredCloseDeps {
  db: Database;
  backend: FiscalBackend;
  clock: TrustedClock;
  admission: TradingAdmission;
  log?: Logger;
  attendance?: AttendanceRecorder;
  disk?: DiskFullState;
  diskBlockedBeforeQueue?: boolean;
  /** Read-only: may this session release every one of these orders' party? */
  admitPartyRelease: (
    tx: Transaction,
    orderIds: readonly string[],
  ) => Promise<"allowed" | "scope" | "authority">;
}

/**
 * Close one bill, final in Waitron, as a deferred payment: issue its invoice unless it has
 * one, settle it with one deferred tender for the whole total, finish its party when every check
 * passes, and keep the answer. Runs in the caller's issuance transaction; any failure rolls back
 * all of it, the invoice included.
 */
export async function closeBillDeferredTx(
  tx: Transaction,
  deps: DeferredCloseDeps,
  cfg: DeviceRequestConfig,
  sent: CloseDeferredRequest,
  actorId: string,
): Promise<CloseDeferredResult> {
  const request = normalised(deps.backend, sent);
  const fingerprint = requestFingerprint(cfg, request, actorId);
  const replayed = await replay(tx, cfg, request, actorId, fingerprint);
  if (replayed !== null) return replayed;
  const billId = request.id;
  if (deps.diskBlockedBeforeQueue === true || deps.disk?.noted() === true)
    refuseForDiskStop(deps.log, billId);
  await requireEconomicWrite(tx, cfg, deps.admission);
  const reading = deps.clock.now();
  await deps.backend.refuseUntilRecordable(tx, reading);
  await deps.backend.refuseNewIssuance(tx, cfg.nodeId);
  deps.backend.assertRecordableAt(reading);
  // One reading prices the invoice and dates the settlement, the order and the closure.
  const clock = await prepareIssueClock(tx, cfg, pinnedAt(deps.clock, reading));
  const closedAt = clock.now().instant;
  const businessDay = businessDayAt(await resolveVenueClock(tx, cfg.nodeId), closedAt);
  const [frozen] = await tx
    .select({ nodeId: dailyCloses.nodeId })
    .from(dailyCloses)
    .where(and(eq(dailyCloses.nodeId, cfg.nodeId), eq(dailyCloses.businessDay, businessDay)))
    .limit(1);
  if (frozen !== undefined)
    throw new AppError("deferred_close.day_frozen", { nodeId: cfg.nodeId, businessDay });

  const [order] = await tx.select().from(workingOrders).where(eq(workingOrders.id, billId));
  if (order === undefined) throw new AppError("working_order.not_open", { workingOrderId: billId });
  const ineligible = (reason: IneligibleReason) =>
    new AppError("deferred_close.ineligible", { workingOrderId: billId, reason });
  if (order.nodeId !== cfg.nodeId) throw ineligible("other_node");
  const finishing = request.partyFinish;
  const family =
    finishing === null || order.partyId === null ? null : await partyFamily(tx, finishing.partyId);
  if (finishing !== null && (order.partyId === null || !family!.includes(order.partyId)))
    throw invalid("partyFinish");
  if (order.status === "settled") throw ineligible("final_without_deferral");
  if (order.status === "abandoned") throw ineligible("void");
  if (order.revision !== request.expectedRevision)
    throw new AppError("working_order.out_of_date", {
      workingOrderId: billId,
      revision: order.revision,
    });
  await requireOrderBillEditor(tx, billId, {
    operatorId: actorId,
    expectedEdit: request.expectedEdit,
  });
  await assertBillHasNoUnsent(tx, billId);
  if ((await billsHoldingMoney(tx, [billId])).has(billId)) throw ineligible("prior_payment");
  await refusePaymentInFlight(tx, [billId]);
  await refusePlacedPaymentInFlight(deps.db, tx, [billId]);

  const [issued] = await tx.select().from(sales).where(eq(sales.workingOrderId, billId));
  if (issued !== undefined) {
    if (issued.nodeId !== cfg.nodeId) throw ineligible("other_node");
    if (issued.correctsSaleId !== null) throw ineligible("correction");
    await refuseTouchedSale(tx, issued.id, ineligible);
  }
  if ((await stagedChoice(tx, order, issued)) !== requestedChoice(request))
    throw new AppError("deferred_close.conflict", { workingOrderId: billId });
  let invoice: PricedInvoice | undefined;
  let total: Decimal;
  if (issued !== undefined) {
    total = centsToDecimal(issued.total);
  } else {
    if (order.partyId === null) await refuseUnavailableFullInvoice(tx, billId);
    invoice = await priceForIssuance(tx, clock, deps.backend, cfg, billId);
    total = invoice.priced.total;
  }
  const cents = decimalToCents(total);
  if (cents <= 0) throw ineligible("non_positive");
  if (centsToDecimal(cents) !== request.expectedTotal)
    throw new AppError("deferred_close.conflict", { workingOrderId: billId });
  const saleId =
    invoice === undefined
      ? (issued!.id as SaleId)
      : (
          await issueUnpaidInvoice(
            tx,
            deps.backend,
            cfg,
            invoice,
            actorId,
            deps.admission,
            deps.log,
          )
        ).saleId;

  const placedHere = order.status === "open";
  if (placedHere) await markOrderPlaced(tx, clock, cfg, billId, actorId, deps.attendance);
  const label =
    invoice === undefined
      ? undefined
      : (await readReceiptOrder(tx, billId, { atIssuance: true })).orderLabel;
  await settleIssuedOrder(
    tx,
    { workingOrderId: billId, saleId, label },
    [
      {
        method: "deferred",
        amount: total,
        tipAmount: "0.00",
        cashTendered: null,
        settledAt: closedAt,
      },
    ],
    closedAt,
    deps.log,
  );

  const attendance =
    deps.attendance === undefined ? undefined : { recorder: deps.attendance, clock };
  const party = await finishParty(
    tx,
    deps,
    cfg,
    order.partyId,
    family,
    request,
    actorId,
    attendance,
  );
  if (!placedHere)
    await captureKitchenActivity(tx, attendance, actorId, [billId], request.submissionId);

  const result: CloseDeferredResult = {
    submissionId: request.submissionId,
    workingOrderId: billId,
    saleId,
    invoiceNumber: (await readInvoiceNumbers(tx, [saleId])).get(saleId)!,
    classification: "deferred_payment",
    closedAt: closedAt.toISOString(),
    businessDay,
    total,
    currency: "EUR",
    party,
  };
  await tx.insert(deferredClosures).values({
    id: request.submissionId,
    workingOrderId: billId,
    saleId,
    fingerprint,
    actorId,
    source: cfg.origin.source,
    deviceId: cfg.origin.deviceId,
    nodeId: cfg.nodeId,
    closedAt: result.closedAt,
    businessDay,
    result,
  });
  return result;
}

export async function readDeferredClosure(
  tx: Transaction,
  workingOrderId: string,
): Promise<CloseDeferredResult | null> {
  const [row] = await tx
    .select({ result: deferredClosures.result })
    .from(deferredClosures)
    .where(eq(deferredClosures.workingOrderId, workingOrderId));
  return row?.result ?? null;
}

type IneligibleReason = ErrorParams["deferred_close.ineligible"]["reason"];

const corrections = alias(sales, "corrections");

/** An issued invoice is reused only while nothing has corrected, paid, voided or replaced it. */
async function refuseTouchedSale(
  tx: Transaction,
  saleId: string,
  ineligible: (reason: IneligibleReason) => AppError,
): Promise<void> {
  const [touched] = await touchedSaleQuery(tx, saleId);
  const reasons: [boolean, IneligibleReason][] = [
    [touched!.corrected, "correction"],
    [touched!.tendered, "prior_tender"],
    [touched!.settled, "final_without_deferral"],
    [touched!.voided, "void"],
    [touched!.substituted, "substitution"],
  ];
  const reason = reasons.find(([hit]) => hit)?.[1];
  if (reason !== undefined) throw ineligible(reason);
}

function touchedSaleQuery(tx: Transaction, saleId: string) {
  const any = (query: Parameters<typeof exists>[0]) => exists(query).mapWith(Boolean);
  return tx
    .select({
      corrected: any(
        tx
          .select({ id: corrections.id })
          .from(corrections)
          .where(correctivesOf(sql`${corrections}`, sql`${saleId}`)),
      ),
      tendered: any(tx.select({ id: tenders.id }).from(tenders).where(eq(tenders.saleId, saleId))),
      settled: any(
        tx
          .select({ saleId: saleSettlements.saleId })
          .from(saleSettlements)
          .where(eq(saleSettlements.saleId, saleId)),
      ),
      voided: any(
        tx.select({ saleId: saleVoids.saleId }).from(saleVoids).where(eq(saleVoids.saleId, saleId)),
      ),
      substituted: any(
        tx
          .select({ id: saleSubstitutions.substitutedSaleId })
          .from(saleSubstitutions)
          .where(
            or(
              eq(saleSubstitutions.substitutionSaleId, saleId),
              eq(saleSubstitutions.substitutedSaleId, saleId),
            ),
          ),
      ),
    })
    .from(sales)
    .where(eq(sales.id, saleId));
}

async function finishParty(
  tx: Transaction,
  deps: DeferredCloseDeps,
  cfg: DeviceRequestConfig,
  partyId: string | null,
  /**
   * The named party's family, when the request names one. It is also the bill's own party's
   * family: merging moves every open and presented bill to the surviving party.
   */
  family: string[] | null,
  request: CloseDeferredRequest,
  actorId: string,
  attendance: { recorder: AttendanceRecorder; clock: TrustedClock } | undefined,
): Promise<CloseDeferredResult["party"]> {
  if (partyId === null) return { state: "not_applicable", blockers: [] };
  const bills = await readFamilyBills(tx, family ?? (await partyFamily(tx, partyId)));
  const admitted = await deps.admitPartyRelease(
    tx,
    bills.map((bill) => bill.id),
  );
  if (admitted !== "allowed") return { state: "open", blockers: [admitted] };
  const finishing = request.partyFinish;
  if (finishing === null) return { state: "open", blockers: ["revision"] };
  const args = {
    partyId: finishing.partyId,
    expectedPartyRevision: finishing.expectedPartyRevision,
    operatorId: actorId,
    expectedEdits: finishing.expectedEdits,
  };
  const readiness = await readPartyFinishReadiness(tx, args);
  if (!readiness.ready) return { state: "open", blockers: readiness.blockers };
  await finishPartyService(tx, cfg, { ...args, admission: deps.admission }, attendance);
  return { state: "closed", blockers: [] };
}

/**
 * The answer an earlier close under this submission id or this bill gave, when this request is the same;
 * a different request naming either is refused. Reads only, so it answers while new work cannot.
 */
async function replay(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  request: CloseDeferredRequest,
  actorId: string,
  fingerprint: string,
): Promise<CloseDeferredResult | null> {
  const kept = {
    id: deferredClosures.id,
    fingerprint: deferredClosures.fingerprint,
    result: deferredClosures.result,
  };
  const [byId] = await tx
    .select(kept)
    .from(deferredClosures)
    .where(eq(deferredClosures.id, request.submissionId));
  if (byId !== undefined) {
    if (byId.fingerprint !== fingerprint)
      throw new AppError("submission.id_reused", { submissionId: request.submissionId });
    return byId.result;
  }
  const [byBill] = await tx
    .select(kept)
    .from(deferredClosures)
    .where(eq(deferredClosures.workingOrderId, request.id));
  if (byBill === undefined) return null;
  if (
    requestFingerprint(cfg, { ...request, submissionId: byBill.id }, actorId) !== byBill.fingerprint
  )
    throw new AppError("deferred_close.conflict", { workingOrderId: request.id });
  return byBill.result;
}

function normalised(backend: FiscalBackend, request: CloseDeferredRequest): CloseDeferredRequest {
  const uuid = (value: string) => value.toLowerCase();
  const edit = (expected: BillEditExpected): BillEditExpected => ({
    billId: uuid(expected.billId),
    editorVersion: expected.editorVersion,
    draftId: expected.draftId === null ? null : uuid(expected.draftId),
    draftRevision: expected.draftRevision,
  });
  const finishing = request.partyFinish;
  return {
    id: uuid(request.id),
    submissionId: uuid(request.submissionId),
    expectedRevision: request.expectedRevision,
    expectedEdit: request.expectedEdit === null ? null : edit(request.expectedEdit),
    expectedTotal: centsToDecimal(decimalToCents(decimal(request.expectedTotal))),
    invoiceType: request.invoiceType,
    recipient:
      request.recipient === null ? null : checkedInvoiceRecipient(backend, request.recipient),
    receiptLanguage: request.receiptLanguage,
    delivery: normalisedDelivery(request.delivery),
    partyFinish:
      finishing === null
        ? null
        : {
            partyId: uuid(finishing.partyId),
            expectedPartyRevision: finishing.expectedPartyRevision,
            expectedEdits: finishing.expectedEdits
              .map(edit)
              .sort((a, b) => (a.billId < b.billId ? -1 : 1)),
          },
  };
}

/** Spelled as staging stores it: a printer id in lower case, an address trimmed. */
function normalisedDelivery(delivery: BillInvoiceDelivery | null): BillInvoiceDelivery | null {
  if (delivery === null) return null;
  if (delivery.medium === "receipt") return { medium: "receipt" };
  if (delivery.medium === "a4")
    return { medium: "a4", pagePrinterId: delivery.pagePrinterId.toLowerCase() };
  return { medium: "email", recipient: delivery.recipient.trim() };
}

function requestedChoice(request: CloseDeferredRequest): string {
  return canonicalJson({
    invoiceType: request.invoiceType,
    recipient: request.recipient,
    language: request.receiptLanguage,
    delivery: request.delivery,
  });
}

/** The bill's staged invoice choice, or what its issued invoice froze. */
async function stagedChoice(
  tx: Transaction,
  order: typeof workingOrders.$inferSelect,
  issued: typeof sales.$inferSelect | undefined,
): Promise<string> {
  const recipient =
    issued !== undefined
      ? issued.counterpartyTaxId === null
        ? null
        : {
            taxId: issued.counterpartyTaxId,
            ...storedRecipientIdentifier(
              issued.counterpartyIdentifierType,
              issued.counterpartyIdentifierCountryCode,
            ),
            legalName: issued.counterpartyLegalName,
            address: issued.counterpartyAddress,
            countryCode: issued.counterpartyCountryCode,
          }
      : order.invoiceType === "F1"
        ? {
            taxId: order.recipientTaxId,
            ...storedRecipientIdentifier(
              order.recipientIdentifierType,
              order.recipientIdentifierCountryCode,
            ),
            legalName: order.recipientLegalName,
            address: order.recipientAddress,
            countryCode: order.recipientCountryCode,
          }
        : null;
  const language =
    issued?.locale ??
    (
      await saleLanguageFor(tx, order.receiptLocale ?? undefined, {
        log: undefined,
        workingOrderId: order.id,
      })
    ).locale;
  return canonicalJson({
    invoiceType: order.invoiceType,
    recipient,
    language,
    delivery: order.invoiceDelivery === null ? null : billInvoiceDelivery(order.invoiceDelivery),
  });
}

/** The request's SHA-256, bound to who sent it from where. */
function requestFingerprint(
  cfg: DeviceRequestConfig,
  request: CloseDeferredRequest,
  actorId: string,
): string {
  const canonical = { actorId, origin: cfg.origin, nodeId: cfg.nodeId, request };
  return createHash("sha256").update(canonicalJson(canonical)).digest("hex");
}
