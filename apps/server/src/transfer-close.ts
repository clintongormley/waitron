import { and, eq, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  billPayments,
  dailyCloses,
  saleSettlements,
  saleSubstitutions,
  saleVoids,
  sales,
  tenders,
  transferClosures,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { settleSale } from "@waitron/core";
import { prepareIssueClock } from "@waitron/fiscal";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { resolveVenueClock } from "@waitron/reporting";
import { AppError, businessDayAt, centsToDecimal, decimal, decimalToCents } from "@waitron/shared";
import type { Decimal, ErrorParams, SaleId } from "@waitron/shared";
import { captureKitchenActivity, type AttendanceRecorder } from "./attendance-capture.js";
import { invalid } from "./bill-allocation.js";
import { requireOrderBillEditor } from "./bill-editing.js";
import { clearBillRequestIfPaid } from "./bill-request.js";
import { assertBillHasNoUnsent } from "./bill-unsent.js";
import { refuseForDiskStop, type DiskFullState } from "./disk-full-state.js";
import { finishPartyService, readPartyFinishReadiness } from "./finish-party-service.js";
import { pinnedAt } from "./issue-moment.js";
import type { Logger } from "./logger.js";
import { VENUE_SERVICE } from "./modules.js";
import { canonicalJson, partyFamily, readFamilyBills } from "./parties.js";
import { refusePlacedPaymentInFlight } from "./till-sale.js";
import { requireEconomicWrite, type TradingAdmission } from "./trading-admission.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import type { CloseByTransferRequest, CloseByTransferResult } from "./transfer-close-types.js";
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

export interface TransferCloseDeps {
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

type Party = CloseByTransferResult["party"];

/**
 * Close one bill, final in Waitron, as to be paid by transfer: issue its invoice unless it has
 * one, settle it with one transfer tender for the whole total, finish its party when every check
 * passes, and keep the answer. Runs in the caller's issuance transaction; any failure rolls back
 * all of it, the invoice included.
 */
export async function closeBillByTransferTx(
  tx: Transaction,
  deps: TransferCloseDeps,
  cfg: DeviceRequestConfig,
  request: CloseByTransferRequest,
  actorId: string,
): Promise<CloseByTransferResult> {
  const billId = request.id;
  if (deps.diskBlockedBeforeQueue === true || deps.disk?.noted() === true)
    refuseForDiskStop(deps.log, billId);
  await requireEconomicWrite(tx, cfg, deps.admission);
  const reading = deps.clock.now();
  await deps.backend.refuseWhileClockBehind(tx, reading);
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
    throw new AppError("transfer_close.day_frozen", { nodeId: cfg.nodeId, businessDay });

  const [order] = await tx.select().from(workingOrders).where(eq(workingOrders.id, billId));
  if (order === undefined) throw new AppError("working_order.not_open", { workingOrderId: billId });
  const ineligible = (reason: IneligibleReason) =>
    new AppError("transfer_close.ineligible", { workingOrderId: billId, reason });
  if (order.nodeId !== cfg.nodeId) throw ineligible("other_node");
  const finishing = request.partyFinish;
  if (
    finishing !== null &&
    (order.partyId === null || !(await partyFamily(tx, finishing.partyId)).includes(order.partyId))
  )
    throw invalid("partyFinish");
  if (order.status === "settled") throw ineligible("final_without_transfer");
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
  const [payment] = await tx
    .select({ id: billPayments.id })
    .from(billPayments)
    .where(eq(billPayments.workingOrderId, billId))
    .limit(1);
  if (payment !== undefined) throw ineligible("prior_payment");
  await refusePaymentInFlight(tx, [billId]);
  await refusePlacedPaymentInFlight(deps.db, tx, [billId]);
  if (order.invoiceType !== request.invoiceType)
    throw new AppError("transfer_close.conflict", { workingOrderId: billId });

  const [issued] = await tx.select().from(sales).where(eq(sales.workingOrderId, billId));
  let invoice: PricedInvoice | undefined;
  let total: Decimal;
  if (issued !== undefined) {
    if (issued.nodeId !== cfg.nodeId) throw ineligible("other_node");
    if (issued.correctsSaleId !== null) throw ineligible("correction");
    await refuseTouchedSale(tx, issued.id, ineligible);
    total = centsToDecimal(issued.total);
  } else {
    if (order.partyId === null) await refuseUnavailableFullInvoice(tx, billId);
    invoice = await priceForIssuance(tx, clock, deps.backend, cfg, billId);
    total = invoice.priced.total;
  }
  if (decimalToCents(total) <= 0) throw ineligible("non_positive");
  if (decimalToCents(total) !== decimalToCents(decimal(request.expectedTotal)))
    throw new AppError("transfer_close.conflict", { workingOrderId: billId });
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
  await settleSale(tx, {
    saleId,
    tenders: [
      {
        method: "transfer",
        amount: total,
        tipAmount: "0.00",
        cashTendered: null,
        settledAt: closedAt,
      },
    ],
  });
  await tx
    .update(workingOrders)
    .set({ status: "settled", settledAt: closedAt.toISOString() })
    .where(eq(workingOrders.id, billId));
  await VENUE_SERVICE.withdrawPendingDepartmentTransfers(tx, [billId]);
  await clearBillRequestIfPaid(tx, billId, deps.log);

  const attendance =
    deps.attendance === undefined ? undefined : { recorder: deps.attendance, clock };
  const party = await finishParty(tx, deps, cfg, order.partyId, request, actorId, attendance);
  if (!placedHere)
    await captureKitchenActivity(tx, attendance, actorId, [billId], request.operationId);

  const result: CloseByTransferResult = {
    operationId: request.operationId,
    workingOrderId: billId,
    saleId,
    invoiceNumber: (await readInvoiceNumbers(tx, [saleId])).get(saleId)!,
    classification: "to_be_paid_by_transfer",
    closedAt: closedAt.toISOString(),
    businessDay,
    total,
    currency: "EUR",
    party,
  };
  await tx.insert(transferClosures).values({
    id: request.operationId,
    workingOrderId: billId,
    saleId,
    intent: intentDigest(cfg, request, actorId),
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

export async function readTransferClosure(
  tx: Transaction,
  workingOrderId: string,
): Promise<CloseByTransferResult | null> {
  const [row] = await tx
    .select({ result: transferClosures.result })
    .from(transferClosures)
    .where(eq(transferClosures.workingOrderId, workingOrderId));
  return row?.result ?? null;
}

type IneligibleReason = ErrorParams["transfer_close.ineligible"]["reason"];

/** An issued invoice is reused only while nothing has corrected, paid, voided or replaced it. */
async function refuseTouchedSale(
  tx: Transaction,
  saleId: string,
  ineligible: (reason: IneligibleReason) => AppError,
): Promise<void> {
  const [correction] = await tx
    .select({ id: sales.id })
    .from(sales)
    .where(eq(sales.correctsSaleId, saleId))
    .limit(1);
  if (correction !== undefined) throw ineligible("correction");
  const [tender] = await tx
    .select({ id: tenders.id })
    .from(tenders)
    .where(eq(tenders.saleId, saleId))
    .limit(1);
  if (tender !== undefined) throw ineligible("prior_tender");
  const [settled] = await tx
    .select({ saleId: saleSettlements.saleId })
    .from(saleSettlements)
    .where(eq(saleSettlements.saleId, saleId));
  if (settled !== undefined) throw ineligible("final_without_transfer");
  const [voided] = await tx
    .select({ saleId: saleVoids.saleId })
    .from(saleVoids)
    .where(eq(saleVoids.saleId, saleId));
  if (voided !== undefined) throw ineligible("void");
  const [substituted] = await tx
    .select({ id: saleSubstitutions.substitutedSaleId })
    .from(saleSubstitutions)
    .where(
      or(
        eq(saleSubstitutions.substitutionSaleId, saleId),
        eq(saleSubstitutions.substitutedSaleId, saleId),
      ),
    )
    .limit(1);
  if (substituted !== undefined) throw ineligible("substitution");
}

/**
 * The party after this bill closed: finished through explicit finish when release is admitted,
 * expectations were sent and readiness finds nothing in the way; otherwise left open with why.
 */
async function finishParty(
  tx: Transaction,
  deps: TransferCloseDeps,
  cfg: DeviceRequestConfig,
  partyId: string | null,
  request: CloseByTransferRequest,
  actorId: string,
  attendance: { recorder: AttendanceRecorder; clock: TrustedClock } | undefined,
): Promise<Party> {
  if (partyId === null) return { state: "not_applicable", blockers: [] };
  const bills = await readFamilyBills(tx, await partyFamily(tx, partyId));
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
 * The request's SHA-256 over one canonical spelling, bound to who sent it from where. Every value
 * and revision is kept; expected edits are a set, so their order is not.
 */
function intentDigest(
  cfg: DeviceRequestConfig,
  request: CloseByTransferRequest,
  actorId: string,
): string {
  const uuid = (value: string) => value.toLowerCase();
  const edits = (list: CloseByTransferRequest["partyFinish"] & object) =>
    [...list.expectedEdits]
      .map((edit) => ({ ...edit, billId: uuid(edit.billId) }))
      .sort((a, b) => a.billId.localeCompare(b.billId));
  const canonical = {
    actorId,
    origin: cfg.origin,
    nodeId: cfg.nodeId,
    request: {
      ...request,
      id: uuid(request.id),
      operationId: uuid(request.operationId),
      expectedTotal: centsToDecimal(decimalToCents(decimal(request.expectedTotal))),
      partyFinish:
        request.partyFinish === null
          ? null
          : {
              ...request.partyFinish,
              partyId: uuid(request.partyFinish.partyId),
              expectedEdits: edits(request.partyFinish),
            },
    },
  };
  return createHash("sha256").update(canonicalJson(canonical)).digest("hex");
}
