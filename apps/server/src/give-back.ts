import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { findAdjustmentReason, readCancelsForRefund } from "@waitron/adjustments";
import { correctionTargetFor } from "@waitron/core";
import {
  adjustments,
  invoiceCorrections,
  withTransaction,
  refunds as refundRows,
  saleLines,
  sales,
  tenders as tenderRows,
  type Transaction,
} from "@waitron/db";
import type { FiscalBackend, TrustedReading } from "@waitron/fiscal";
import {
  authorize,
  holds,
  type Authorization,
  type Override,
  type PersonAuthority,
  type PinAttempts,
  type SecretCheck,
} from "@waitron/identity";
import { payments } from "@waitron/payments";
import { codeOf } from "@waitron/server-kit";
import {
  addDecimal,
  AppError,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  isUuid,
  sumDecimals,
  thousandthsToDecimal,
  type Decimal,
  type SaleId,
} from "@waitron/shared";
import { refusePlainRefundOfAdvance } from "./advance-taken-off.js";
import { invalid } from "./bill-allocation.js";
import type { RefundProviderFor } from "./bill-refunds.js";
import { filedFamilyOf, isFree, pairFiling, readBillFiling } from "./cancellation-refund-value.js";
import { assertTakesTender, type DeviceBinding } from "./device-session.js";
import { giveCorrectionCash } from "./invoice-correction-cash.js";
import {
  correctionOpenRefusal,
  openCorrectionOf,
  readCorrectionLegs,
} from "./invoice-correction-legs.js";
import { closeInvoiceCorrection } from "./invoice-corrections.js";
import {
  openInvoiceCorrection,
  previewInvoiceCorrection,
  readCorrectableNow,
  readInvoiceCorrection,
  recordsNeedChecking,
  uuidOf,
  type InvoiceCorrectionDeps,
  type InvoiceCorrectionView,
} from "./invoice-corrections.js";
import { enqueueRefundDrawer } from "./receipt-print.js";
import { confirmManualRefundAuthority } from "./tender-refund-authorization.js";
import { readRefundableTenders } from "./tender-refund-balance.js";
import { matchTenderRefundCapture } from "./tender-refund-capture.js";
import { carryNewTenderRefund, refuseUntilRefundable } from "./tender-refund-completion.js";
import {
  allocateToCancels,
  authorizeStoredTenderRefund,
  cancelsStillOwedBy,
  isPartPayment,
  moneyCents,
  reserveTenderRefund,
} from "./tender-refund-reservation.js";
import type { RefundableTender } from "./tender-refund-types.js";
import {
  captureFor,
  refuseUnlessProviderRefunds,
  sendsRefunds,
  type TenderRefundDeps,
} from "./tender-refunds.js";
import { claimTenderRefund, resolveClaimedTenderRefund } from "./tender-refund-sends.js";
import type { TenderRefundRequest } from "./tender-refund-types.js";
import { fileCorrectionAutomatically } from "./invoice-correction-alerts.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import { requireEconomicWrite, type TradingAdmission } from "./trading-admission.js";
import "./errors.js";

/** The code (and params) the write would answer. Params stay as the refusal carries them: some
 * codes' params hold lists (`invoice_correction.money_short`'s invoice numbers). */
export interface WaitReason {
  code: string;
  params?: Record<string, unknown>;
}

export interface Availability {
  available: boolean;
  reason: WaitReason | null;
}

export type GiveBackPurpose = "dishes" | "goodwill" | "extra";

export interface GiveBackLine extends Availability {
  id: string;
  descriptions: Record<string, string>;
  quantity: string;
  gross: string;
  /** Correct invoice's `left` where it can read the receipt (any refusal: `gross`), less
   * `cancelled.back`; never below 0. */
  left: string;
  /** This line's share of the cancels with Refund ticked on its dish: a cancel's value and what
   * went back of it fill the dish's line first, then each extra's line in turn. */
  cancelled: { quantity: string; owed: string; back: string } | null;
  givenFree: boolean;
}

export interface GiveBackWay {
  /** `"cash"` is every cash payment together; a card is its tender id. */
  way: string;
  last4: string | null;
  manual: boolean;
  moneyLeft: string;
  extraLeft: string;
  pending: boolean;
  allowedHere: boolean;
  reason: WaitReason | null;
}

export interface GiveBackView {
  lines: GiveBackLine[];
  ways: GiveBackWay[];
  underWay: InvoiceCorrectionView | null;
  choices: Record<GiveBackPurpose, Availability>;
}

export interface GiveBackDeps {
  backend: FiscalBackend;
  admission: TradingAdmission;
  /** As the refund write looks a card's provider up; absent, no card reader refund can be sent. */
  refundProviderFor?: RefundProviderFor;
}

export interface GiveBackWaits {
  /** Stops every choice (cases 4–7). */
  all: WaitReason | null;
  /** Stops money that needs a corrective (cases 1 and 2); null while `all` holds. */
  correction: WaitReason | null;
  /** Stops all payment money: a part payment's ticket Correct invoice cannot take, whose plain
   * refund the write refuses (cases 9 and 10); null while `all` holds. */
  money: WaitReason | null;
}

const ZERO = decimal("0.00");
const positive = (value: Decimal) => compareDecimal(value, ZERO) > 0;

function reasonOf(error: AppError): WaitReason {
  return { code: error.code, params: { ...error.params } };
}

async function waitOf(check: () => Promise<unknown>): Promise<WaitReason | null> {
  try {
    await check();
    return null;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return reasonOf(error);
  }
}

/** What makes a give-back on `saleId` wait now, from the checks the write runs, in its order;
 * `openCorrectionId` and `correctionWaiting` are what `openCorrectionOf` and
 * `readCorrectableNow` answered, `correctable` its correctable cents and `tenderId` a payment
 * still holding money. */
export async function giveBackWaits(
  tx: Transaction,
  deps: GiveBackDeps,
  cfg: DeviceRequestConfig,
  reading: TrustedReading,
  saleId: SaleId,
  read: {
    openCorrectionId: string | undefined;
    correctionWaiting: AppError | null;
    correctable: number;
    tenderId: string | undefined;
    /** `recordsNeedChecking`'s answer, read once however often it is asked. */
    recordsUnchecked: () => Promise<boolean>;
  },
): Promise<GiveBackWaits> {
  const all = await waitOf(async () => {
    await requireEconomicWrite(tx, cfg, deps.admission);
    if (read.openCorrectionId !== undefined)
      throw correctionOpenRefusal(saleId, read.openCorrectionId);
    await refuseUntilRefundable(tx, deps.backend, cfg.nodeId, reading);
  });
  if (all !== null) return { all, correction: null, money: null };
  const { tenderId } = read;
  const money =
    read.correctionWaiting === null &&
    tenderId !== undefined &&
    (await isPartPayment(tx, saleId)) &&
    (read.correctable === 0 || (await read.recordsUnchecked()))
      ? await waitOf(() => refusePlainRefundOfAdvance(tx, saleId, { tenderId }))
      : null;
  return {
    all,
    correction: read.correctionWaiting === null ? null : reasonOf(read.correctionWaiting),
    money,
  };
}

type WayMoney = Pick<GiveBackWay, "moneyLeft" | "extraLeft" | "pending" | "reason">;

/** Whether any payment money can go back now: only a way with no `reason` gives it; with none,
 * the reason of the first way still holding money, or none where no money is left at all. */
export function moneyAvailability(ways: readonly WayMoney[]): Availability {
  const usable = ways.filter((way) => way.reason === null);
  if (positive(sumDecimals(usable.map((way) => decimal(way.moneyLeft)))))
    return { available: true, reason: null };
  const held = ways.find((way) => way.reason !== null && positive(decimal(way.moneyLeft)));
  return { available: false, reason: held?.reason ?? null };
}

/** Whether `line` can be ticked now: never while no payment money can go back
 * ({@link moneyAvailability}), and while a corrective waits only for what its cancel still owes. */
export function lineAvailability(
  line: Pick<GiveBackLine, "left" | "cancelled">,
  waits: GiveBackWaits,
  money: Availability,
): Availability {
  if (waits.all !== null) return { available: false, reason: waits.all };
  if (!money.available) return money;
  if (waits.money !== null) return { available: false, reason: waits.money };
  const open = waits.correction === null ? line.left : (line.cancelled?.owed ?? "0.00");
  if (positive(decimal(open))) return { available: true, reason: null };
  return { available: false, reason: waits.correction };
}

/** Whether each choice can be used now, from the lines and ways already worked out. */
export function choiceAvailability(
  lines: readonly Availability[],
  ways: readonly WayMoney[],
  waits: GiveBackWaits,
): Record<GiveBackPurpose, Availability> {
  if (waits.all !== null) {
    const closed = { available: false, reason: waits.all };
    return { dishes: closed, goodwill: closed, extra: closed };
  }
  const money = moneyAvailability(ways);
  const waiting = waits.money ?? waits.correction;
  const dishes = lines.some((line) => line.available)
    ? { available: true, reason: null }
    : money.available
      ? { available: false, reason: waiting }
      : money;
  const goodwill = !money.available
    ? money
    : waiting !== null
      ? { available: false, reason: waiting }
      : { available: true, reason: null };
  const withExtra = ways.filter((way) => positive(decimal(way.extraLeft)));
  const extra = withExtra.some((way) => way.reason === null)
    ? { available: true, reason: null }
    : { available: false, reason: withExtra[0]?.reason ?? null };
  return { dishes, goodwill, extra };
}

async function readCancelsOf(tx: Transaction, workingOrderId: string) {
  const ids = await tx
    .select({ id: adjustments.id })
    .from(adjustments)
    .where(
      and(
        eq(adjustments.workingOrderId, workingOrderId),
        eq(adjustments.action, "cancel"),
        eq(adjustments.refundHandoff, true),
      ),
    );
  return ids.length === 0
    ? []
    : readCancelsForRefund(
        tx,
        ids.map((row) => row.id),
      );
}

type CancelShare = { quantity: Decimal; owed: Decimal; back: Decimal };

/** Fills `amount` cents into `caps` in order, what is left over on the first. */
function spread(amount: number, caps: readonly number[]): number[] {
  let left = amount;
  const shares = caps.map((cap) => {
    const share = Math.min(Math.max(cap, 0), left);
    left -= share;
    return share;
  });
  if (shares.length > 0) shares[0] = shares[0]! + left;
  return shares;
}

/** The cancels with Refund ticked and the free dishes of the receipt `saleId`, keyed by the line
 * of `toLine` each filed row becomes. */
async function cancelsAndFreeByLine(
  tx: Transaction,
  saleId: SaleId,
  toLine: (filedRowId: string) => string | undefined,
) {
  const cancelled = new Map<string, CancelShare>();
  const cancelIds = new Map<string, string[]>();
  const free = new Set<string>();
  const [sale] = await tx
    .select({ workingOrderId: sales.workingOrderId })
    .from(sales)
    .where(eq(sales.id, saleId));
  if (sale?.workingOrderId == null) return { cancelled, cancelIds, free };
  const filing = await readBillFiling(tx, sale.workingOrderId, saleId);
  const pairs = pairFiling(filing);
  for (const line of filing.stored.filter(isFree)) {
    const dish = filedFamilyOf(filing, pairs, line.id)?.[0];
    const id = dish === undefined ? undefined : toLine(dish.rowId);
    if (id !== undefined) free.add(id);
  }
  for (const cancel of await readCancelsOf(tx, sale.workingOrderId)) {
    if (cancel.lineId === null || cancel.refundValue === null) continue;
    const family = filedFamilyOf(filing, pairs, cancel.lineId);
    if (family === undefined) continue;
    const values = spread(
      decimalToCents(cancel.refundValue),
      family.map((row) => row.share),
    );
    const backs = spread(decimalToCents(cancel.linked), values);
    for (const [i, row] of family.entries()) {
      const id = toLine(row.rowId);
      if (id === undefined || values[i] === 0) continue;
      const before = cancelled.get(id) ?? { quantity: decimal("0.000"), owed: ZERO, back: ZERO };
      cancelled.set(id, {
        quantity: addDecimal(before.quantity, cancel.quantity ?? decimal("0.000")),
        owed: addDecimal(before.owed, centsToDecimal(Math.max(0, values[i]! - backs[i]!))),
        back: addDecimal(before.back, centsToDecimal(backs[i]!)),
      });
      cancelIds.set(id, [...(cancelIds.get(id) ?? []), cancel.id]);
    }
  }
  return { cancelled, cancelIds, free };
}

const filedLines = (tx: Transaction, saleId: string) =>
  tx
    .select({
      id: saleLines.id,
      lineNo: saleLines.lineNo,
      descriptions: saleLines.descriptions,
      quantity: saleLines.quantity,
      lineGross: saleLines.lineGross,
    })
    .from(saleLines)
    .where(
      and(
        eq(saleLines.saleId, saleId),
        or(isNull(saleLines.advanceRole), ne(saleLines.advanceRole, "deduction")),
      ),
    )
    .orderBy(asc(saleLines.lineNo));

/** The lines Correct invoice works on for `saleId` (a replacement's, once one took its place) and
 * the line each of `saleId`'s own filed rows became: a replacement copies them at the same line
 * numbers. */
async function receiptLines(tx: Transaction, saleId: SaleId) {
  const target = await correctionTargetFor(tx, saleId);
  const lines = await filedLines(tx, target);
  if (target === saleId) return { lines, toLine: (id: string) => id };
  const byNumber = new Map(lines.map((line) => [line.lineNo, line.id]));
  const own = new Map(
    (await filedLines(tx, saleId)).map((line) => [line.id, byNumber.get(line.lineNo)]),
  );
  return { lines, toLine: (id: string) => own.get(id) };
}

function tenderKind(tender: RefundableTender) {
  return tender.method === "cash" ? "cash" : tender.manual ? "hand-keyed-card" : "reader-card";
}

function takesHere(device: DeviceBinding | null, tender: RefundableTender): boolean {
  try {
    assertTakesTender(device, tenderKind(tender));
    return true;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return false;
  }
}

/** The reader-card tenders of `refundable` whose capture's provider cannot send a refund (case 8),
 * as the refund write finds the capture and asks the provider. */
async function readersThatCannotRefund(
  tx: Transaction,
  deps: GiveBackDeps,
  saleId: SaleId,
  refundable: readonly RefundableTender[],
): Promise<Set<string>> {
  const refused = new Set<string>();
  const readers = refundable.filter((row) => row.method === "card" && !row.manual);
  if (readers.length === 0) return refused;
  const originals = await tx.select().from(tenderRows).where(eq(tenderRows.saleId, saleId));
  const billIds = originals.flatMap((row) =>
    row.billPaymentId === null ? [] : [row.billPaymentId],
  );
  const captures = await tx
    .select()
    .from(payments)
    .where(
      or(
        eq(payments.saleId, saleId),
        billIds.length === 0 ? undefined : inArray(payments.billPaymentId, billIds),
      ),
    );
  const directCards = originals.filter(
    (row) => row.method === "card" && row.billPaymentId === null,
  ).length;
  for (const reader of readers) {
    const tender = originals.find((row) => row.id === reader.tenderId)!;
    const capture = matchTenderRefundCapture(
      { ...tender, amount: centsToDecimal(tender.amount) },
      captures,
      directCards,
    );
    const provider =
      capture === undefined ? undefined : await deps.refundProviderFor?.(capture.provider);
    if (capture === undefined || !sendsRefunds(provider, capture.provider))
      refused.add(reader.tenderId);
  }
  return refused;
}

function waysOf(
  refundable: readonly RefundableTender[],
  device: DeviceBinding | null,
  cannotRefund: ReadonlySet<string>,
): GiveBackWay[] {
  const cash = refundable.filter((tender) => tender.method === "cash");
  const groups = [
    ...(cash.length === 0 ? [] : [{ way: "cash", group: cash }]),
    ...refundable
      .filter((tender) => tender.method === "card")
      .map((tender) => ({ way: tender.tenderId, group: [tender] })),
  ];
  return groups.map(({ way, group }) => {
    const pending = group.find((tender) => tender.pendingRefundId !== null);
    const first = group[0]!;
    return {
      way,
      last4: first.last4,
      manual: first.manual,
      moneyLeft: sumDecimals(group.map((tender) => decimal(tender.appliedRemaining))),
      extraLeft: sumDecimals(group.map((tender) => decimal(tender.tipRemaining))),
      pending: pending !== undefined,
      allowedHere: takesHere(device, first),
      reason:
        pending !== undefined
          ? { code: "tender.refund_in_progress", params: { tenderId: pending.tenderId } }
          : cannotRefund.has(first.tenderId)
            ? { code: "tender.refund_unavailable", params: { tenderId: first.tenderId } }
            : null,
    };
  });
}

/** The read, with what the routing works from beside it. */
interface GiveBackFacts {
  view: GiveBackView;
  waits: GiveBackWaits;
  tenders: RefundableTender[];
  /** What Correct invoice could give back now, in cents, before the records are checked. */
  correctable: number;
  /** The cancels with Refund ticked on each line. */
  cancelIds: ReadonlyMap<string, readonly string[]>;
  recordsUnchecked: () => Promise<boolean>;
}

async function readFacts(
  tx: Transaction,
  deps: GiveBackDeps,
  cfg: DeviceRequestConfig,
  reading: TrustedReading,
  saleId: SaleId,
  device: DeviceBinding | null,
): Promise<GiveBackFacts> {
  const correctable = await readCorrectableNow(tx, deps.backend, cfg, reading, saleId, () => false);
  const openCorrectionId = await openCorrectionOf(tx, saleId);
  let unchecked: Promise<boolean> | undefined;
  const recordsUnchecked = () => (unchecked ??= recordsNeedChecking(tx, deps.backend, cfg.nodeId));
  const waits = await giveBackWaits(tx, deps, cfg, reading, saleId, {
    recordsUnchecked,
    openCorrectionId,
    correctionWaiting: correctable.waiting,
    correctable: correctable.amounts.correctable,
    tenderId: correctable.tenders.find((row) => positive(decimal(row.appliedRemaining)))?.tenderId,
  });
  const ways = waysOf(
    correctable.tenders,
    device,
    await readersThatCannotRefund(tx, deps, saleId, correctable.tenders),
  );
  const money = moneyAvailability(ways);
  const { lines: filed, toLine } = await receiptLines(tx, saleId);
  const { cancelled, cancelIds, free } = await cancelsAndFreeByLine(tx, saleId, toLine);
  const correctableLeft = new Map(correctable.lines?.map((line) => [line.id, line.left]));
  const lines = filed.map((line) => {
    const gross = centsToDecimal(line.lineGross ?? 0);
    const cancel = cancelled.get(line.id);
    const rest =
      decimalToCents(correctableLeft.get(line.id) ?? gross) - decimalToCents(cancel?.back ?? ZERO);
    const left = centsToDecimal(Math.max(0, rest));
    const view = {
      id: line.id,
      descriptions: line.descriptions,
      quantity: thousandthsToDecimal(line.quantity),
      gross,
      left,
      cancelled: cancel ?? null,
      givenFree: free.has(line.id),
    };
    return { ...view, ...lineAvailability(view, waits, money) };
  });
  return {
    view: {
      lines,
      ways,
      underWay:
        openCorrectionId === undefined
          ? null
          : await readInvoiceCorrection(tx, deps.backend, cfg, openCorrectionId),
      choices: choiceAvailability(lines, ways, waits),
    },
    waits,
    tenders: correctable.tenders,
    correctable: correctable.amounts.correctable,
    cancelIds,
    recordsUnchecked,
  };
}

/**
 * What the Give money back window lists for the receipt `saleId`: its lines, the ways money can go
 * back, the give-back under way, and whether each choice can be used now and, when not, why.
 * Writes nothing.
 */
export async function readGiveBack(
  tx: Transaction,
  deps: GiveBackDeps,
  cfg: DeviceRequestConfig,
  reading: TrustedReading,
  saleId: SaleId,
  device: DeviceBinding | null,
): Promise<GiveBackView> {
  return (await readFacts(tx, deps, cfg, reading, saleId, device)).view;
}

export interface GiveBackRequest {
  purpose: GiveBackPurpose;
  /** The ticked lines, for `dishes`. */
  lineIds?: string[];
  /** The money to give back; for `extra`, the extra itself. */
  amount: string;
  /** The extra given back beside dishes or goodwill; "0.00" for `extra`. */
  extra: string;
  /** `"cash"` or a card's tender id, as the read's `ways` name them. */
  way: string;
  /** The cancels the window filled in after Cancel and refund or Finish table was opened with. */
  fromCancel?: string[];
}

export type GiveBackPart =
  | { kind: "refund"; amount: string; way: string; cancellationIds?: string[] }
  | { kind: "extra"; amount: string; way: string }
  | { kind: "correction"; amount: string; way: string; lineIds: string[] };

export type GiveBackRight = "sale.refund" | "sale.rectify";

export interface GiveBackPlan {
  parts: GiveBackPart[];
  /** What the chosen way cannot hold of the correction, left on it for the other payments. */
  leftUnderWay: string;
  /** The rights the parts need that this person lacks. */
  needs: GiveBackRight[];
  manual: boolean;
}

const PURPOSES: readonly string[] = ["dishes", "goodwill", "extra"] satisfies GiveBackPurpose[];

function idsOf(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 100 ||
    value.some((id) => typeof id !== "string" || !isUuid(id))
  )
    throw invalid(field);
  const ids = value.map((id: string) => id.toLowerCase());
  if (new Set(ids).size !== ids.length) throw invalid(field);
  return ids;
}

/** `body` as a {@link GiveBackRequest}, refusing the first field that is not one. */
export function parseGiveBackRequest(body: Record<string, unknown>): GiveBackRequest {
  if (typeof body.purpose !== "string" || !PURPOSES.includes(body.purpose))
    throw invalid("purpose");
  const purpose = body.purpose as GiveBackPurpose;
  if (moneyCents(body.amount, "amount") === 0) throw invalid("amount");
  const extra = moneyCents(body.extra, "extra");
  if (purpose === "extra" && extra !== 0) throw invalid("extra");
  if (typeof body.way !== "string" || body.way === "") throw invalid("way");
  if (purpose === "dishes" ? body.lineIds === undefined : body.lineIds !== undefined)
    throw invalid("lineIds");
  return {
    purpose,
    amount: body.amount as string,
    extra: body.extra as string,
    way: body.way.toLowerCase(),
    ...(body.lineIds === undefined ? {} : { lineIds: idsOf(body.lineIds, "lineIds") }),
    ...(body.fromCancel === undefined ? {} : { fromCancel: idsOf(body.fromCancel, "fromCancel") }),
  };
}

function refusal(reason: WaitReason): AppError {
  return new AppError(reason.code as never, (reason.params ?? {}) as never);
}

function refuseUnless(availability: Availability, field: string): void {
  if (availability.available) return;
  throw availability.reason === null ? invalid(field) : refusal(availability.reason);
}

const cents = (value: string) => decimalToCents(decimal(value));
const sumCents = (values: readonly string[]) =>
  values.reduce((total, value) => total + cents(value), 0);
const owedOf = (line: Pick<GiveBackLine, "cancelled">) => cents(line.cancelled?.owed ?? "0.00");
const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/** Whether the cancels' approval covers a refund of `refund` cents naming `cancellationIds`, as
 * the refund write decides it (D9): only from the window filled in after the cancel, with no extra,
 * never on a hand-keyed card. */
async function coveredByCancel(
  tx: Transaction,
  saleId: SaleId,
  request: GiveBackRequest,
  cancellationIds: readonly string[] | undefined,
  refund: number,
  way: GiveBackWay,
): Promise<boolean> {
  if (
    request.fromCancel === undefined ||
    cancellationIds === undefined ||
    !sameIds(request.fromCancel, cancellationIds) ||
    cents(request.extra) > 0 ||
    way.manual
  )
    return false;
  const allocation = await allocateToCancels(tx, saleId, cancellationIds, refund);
  return allocation.cancelledBy !== undefined && refund <= allocation.canStillTake;
}

/**
 * What giving back `request` on the receipt `saleId` would do (5.2), writing nothing: the plain
 * refunds of what cancels still owe, the extra, then one correction of the rest, each from the
 * chosen way; a refusal the write would answer is thrown. Every choice the read shows unavailable
 * answers the read's reason.
 */
export async function planGiveBack(
  tx: Transaction,
  deps: GiveBackDeps,
  cfg: DeviceRequestConfig,
  reading: TrustedReading,
  saleId: SaleId,
  who: { device: DeviceBinding | null; authority: PersonAuthority },
  body: object,
): Promise<GiveBackPlan> {
  const { plan, rights } = await planWithRights(tx, deps, cfg, reading, saleId, who.device, body);
  return { ...plan, needs: rights.filter((right) => !holds(who.authority, right)) };
}

/** The rights a give-back's parts need, whoever holds them (5.4, D9): `sale.refund` for a plain
 * refund the cancel's approval does not cover, for an extra and for a correction's leg on this way;
 * `sale.rectify` for a correction. */
function rightsFor(parts: {
  refund: boolean;
  refundCovered: boolean;
  extra: boolean;
  correction: boolean;
  leg: boolean;
}): GiveBackRight[] {
  const refund = (parts.refund && !parts.refundCovered) || parts.extra || parts.leg;
  return [
    ...(refund ? ["sale.refund" as const] : []),
    ...(parts.correction ? ["sale.rectify" as const] : []),
  ];
}

async function planWithRights(
  tx: Transaction,
  deps: GiveBackDeps,
  cfg: DeviceRequestConfig,
  reading: TrustedReading,
  saleId: SaleId,
  device: DeviceBinding | null,
  body: object,
): Promise<{ plan: Omit<GiveBackPlan, "needs">; rights: GiveBackRight[] }> {
  const request = parseGiveBackRequest(body as Record<string, unknown>);
  const facts = await readFacts(tx, deps, cfg, reading, saleId, device);
  const { view, waits } = facts;
  refuseUnless(view.choices[request.purpose], "amount");
  const ticked = (request.lineIds ?? []).map((id) => {
    const line = view.lines.find((row) => row.id === id);
    if (line === undefined) throw invalid("lineIds");
    if (line.reason !== null) throw refusal(line.reason);
    return line;
  });
  const way = view.ways.find((row) => row.way === request.way);
  if (way === undefined) throw invalid("way");
  if (way.reason !== null) throw refusal(way.reason);
  const tenders = facts.tenders.filter((row) =>
    way.way === "cash" ? row.method === "cash" : row.tenderId === way.way,
  );
  assertTakesTender(device, tenderKind(tenders[0]!));
  const amount = cents(request.amount);
  const extra = request.purpose === "extra" ? amount : cents(request.extra);
  const wayMoney = cents(way.moneyLeft);

  let owed = 0;
  let cancellationIds: string[] | undefined;
  if (request.purpose === "dishes") {
    owed = ticked.reduce((total, line) => total + owedOf(line), 0);
    const ids = new Set(
      ticked
        .filter((line) => owedOf(line) > 0)
        .flatMap((line) => facts.cancelIds.get(line.id) ?? []),
    );
    if (ids.size > 0) cancellationIds = [...ids];
  } else if (request.purpose === "goodwill") {
    const owedIds = await cancelsStillOwedBy(tx, saleId);
    owed =
      owedIds.length === 0 ? 0 : (await allocateToCancels(tx, saleId, owedIds, 0)).canStillTake;
  }
  let refund = request.purpose === "extra" ? 0 : Math.min(amount, owed);
  let rest = request.purpose === "extra" ? 0 : amount - refund;
  if (extra > cents(way.extraLeft))
    throw new AppError("tender.refund_exceeds_payment", {
      tenderId: tenders[0]!.tenderId,
      applied: way.moneyLeft,
      tip: way.extraLeft,
    });

  let correction: GiveBackPart | undefined;
  let leftUnderWay = 0;
  if (rest > 0) {
    if (waits.correction !== null) throw refusal(waits.correction);
    const correctable =
      facts.correctable > 0 && !(await facts.recordsUnchecked()) ? facts.correctable : 0;
    if (correctable === 0) {
      refund += rest;
      rest = 0;
    } else {
      const usable = view.ways.filter((row) => row.reason === null);
      if (rest > sumCents(usable.map((row) => row.moneyLeft)) - refund) throw invalid("amount");
      const named = ticked.filter((line) => cents(line.left) - owedOf(line) > 0);
      const linesHold =
        named.reduce((total, line) => total + cents(line.left) - owedOf(line), 0) >= rest;
      correction = {
        kind: "correction",
        amount: centsToDecimal(rest),
        way: way.way,
        lineIds: linesHold ? named.map((line) => line.id) : [],
      };
      leftUnderWay = Math.max(0, rest - (wayMoney - refund));
    }
  }
  if (refund > wayMoney) throw invalid("amount");
  if (refund > 0 && (await isPartPayment(tx, saleId)))
    await refusePlainRefundOfAdvance(tx, saleId, { tenderId: tenders[0]!.tenderId });

  const parts: GiveBackPart[] = [];
  if (refund > 0)
    parts.push({
      kind: "refund",
      amount: centsToDecimal(refund),
      way: way.way,
      ...(cancellationIds === undefined ? {} : { cancellationIds }),
    });
  if (extra > 0) parts.push({ kind: "extra", amount: centsToDecimal(extra), way: way.way });
  if (correction !== undefined) parts.push(correction);

  const rights = rightsFor({
    refund: refund > 0,
    refundCovered:
      refund > 0 && (await coveredByCancel(tx, saleId, request, cancellationIds, refund, way)),
    extra: extra > 0,
    correction: correction !== undefined,
    leg: correction !== undefined && rest - leftUnderWay > 0,
  });
  return {
    plan: { parts, leftUnderWay: centsToDecimal(leftUnderWay), manual: way.manual },
    rights,
  };
}

export type GiveBackWriteDeps = GiveBackDeps & InvoiceCorrectionDeps;

/** The ids the till made for one press, one per part it may write. */
export interface GiveBackSubmissionIds {
  refund: string;
  extra: string;
  correction: string;
  leg: string;
}

export type GiveBackPartState = "completed" | "pending" | "failed" | "not_started";

export interface GiveBackOutcome {
  parts: {
    kind: GiveBackPart["kind"];
    amount: string;
    state: GiveBackPartState;
    refundId?: string;
    correctionId?: string;
  }[];
  /** A later part refused after an earlier one moved money. */
  refusal: { code: string; params: object } | null;
  underWay: InvoiceCorrectionView | null;
  /** What was not sent yet; needs fresh ids. */
  rest: null | GiveBackRequest;
}

/** A part as the preview showed it, in a form two spellings of the same part compare equal in. */
interface ComparablePart {
  kind: string;
  amount: number;
  way: string;
  cancellationIds: string[] | null;
  lineIds: string[] | null;
}

function sortedIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !isUuid(id)))
    throw invalid("expected");
  return value.map((id: string) => id.toLowerCase()).sort();
}

function comparablePartsOf(value: unknown): ComparablePart[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) throw invalid("expected");
  return value.map((part: unknown) => {
    if (typeof part !== "object" || part === null) throw invalid("expected");
    const { kind, amount, way, cancellationIds, lineIds } = part as Record<string, unknown>;
    if (typeof kind !== "string" || typeof way !== "string") throw invalid("expected");
    return {
      kind,
      amount: moneyCents(amount, "expected"),
      way: way.toLowerCase(),
      cancellationIds: cancellationIds === undefined ? null : sortedIds(cancellationIds),
      lineIds: lineIds === undefined ? null : sortedIds(lineIds),
    };
  });
}

const partsKey = (parts: readonly ComparablePart[]) => JSON.stringify(parts);

interface GiveBackWrite {
  request: GiveBackRequest;
  reasonId: string;
  note: string | null;
  ids: GiveBackSubmissionIds;
  expected: ComparablePart[];
  /** Staff have already refunded the money on the separate terminal. */
  manualConfirmed: boolean;
}

function parseGiveBackWrite(body: Record<string, unknown>): GiveBackWrite {
  const request = parseGiveBackRequest(body);
  const reasonId = uuidOf(body.reasonId, "reasonId");
  const note = body.note ?? null;
  if (note !== null && typeof note !== "string") throw invalid("note");
  const raw = body.submissionIds;
  if (typeof raw !== "object" || raw === null) throw invalid("submissionIds");
  const given = raw as Record<string, unknown>;
  const ids = {
    refund: uuidOf(given.refund, "submissionIds"),
    extra: uuidOf(given.extra, "submissionIds"),
    correction: uuidOf(given.correction, "submissionIds"),
    leg: uuidOf(given.leg, "submissionIds"),
  };
  if (new Set(Object.values(ids)).size !== 4) throw invalid("submissionIds");
  if (body.manualConfirmed !== undefined && typeof body.manualConfirmed !== "boolean")
    throw invalid("manualConfirmed");
  return {
    manualConfirmed: body.manualConfirmed === true,
    request,
    reasonId,
    note: note === null || note.trim() === "" ? null : note.trim(),
    ids,
    expected: comparablePartsOf(body.expected),
  };
}

/** The id of the `index`th refund one part writes when it takes money from more than one cash
 * payment: the till's own id first, then ids derived from it, so a resend finds every one. */
function partSubmissionId(submissionId: string, index: number): string {
  if (index === 0) return submissionId;
  const hex = createHash("sha256").update(`${submissionId}:${index}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function reasonTextOf(tx: Transaction, ask: GiveBackWrite): Promise<string> {
  const reason = await findAdjustmentReason(tx, ask.reasonId);
  if (reason.noteRequired && ask.note === null) throw new AppError("adjustment.note_required", {});
  return (ask.note === null ? reason.name : `${reason.name}: ${ask.note}`).slice(0, 500);
}

type RefundRow = typeof refundRows.$inferSelect;

interface StoredGiveBack {
  refund: RefundRow[];
  extra: RefundRow[];
  correction: typeof invoiceCorrections.$inferSelect | undefined;
}

/** The rows the press `ids` wrote on `saleId`; undefined when it wrote none. */
async function readStoredGiveBack(
  tx: Transaction,
  saleId: SaleId,
  ids: GiveBackSubmissionIds,
): Promise<StoredGiveBack | undefined> {
  const payments = await tx
    .select({ id: tenderRows.id })
    .from(tenderRows)
    .where(eq(tenderRows.saleId, saleId));
  const idsOfPart = (submissionId: string) =>
    payments.map((_, index) => partSubmissionId(submissionId, index));
  const rows = await tx
    .select()
    .from(refundRows)
    .where(
      and(
        eq(refundRows.saleId, saleId),
        inArray(refundRows.submissionId, [...idsOfPart(ids.refund), ...idsOfPart(ids.extra)]),
      ),
    );
  const [correction] = await tx
    .select()
    .from(invoiceCorrections)
    .where(
      and(
        eq(invoiceCorrections.originalSaleId, saleId),
        eq(invoiceCorrections.submissionId, ids.correction),
      ),
    );
  if (rows.length === 0 && correction === undefined) return undefined;
  // In payment order: a part's refunds share one time, and its `index`th refund is on the
  // `index`th payment it took money from.
  const of = (submissionId: string) => {
    const own = idsOfPart(submissionId);
    return rows
      .filter((row) => own.includes(row.submissionId!))
      .sort((a, b) => own.indexOf(a.submissionId!) - own.indexOf(b.submissionId!));
  };
  return { refund: of(ids.refund), extra: of(ids.extra), correction };
}

function refundsState(rows: readonly RefundRow[]): GiveBackPartState {
  if (rows.some((row) => row.state === "failed")) return "failed";
  return rows.every((row) => row.state === "completed") ? "completed" : "pending";
}

/** What `ask` gives back of the parts not started, as a request the till sends with fresh ids. */
function restOf(ask: GiveBackWrite, answer: GiveBackOutcome["parts"]): GiveBackRequest | null {
  const left = ask.expected.filter((_, index) => answer[index]!.state === "not_started");
  if (left.length === 0) return null;
  const sum = (kinds: readonly string[]) =>
    left
      .filter((part) => kinds.includes(part.kind))
      .reduce((total, part) => total + part.amount, 0);
  const amount = sum(["refund", "correction"]);
  const extra = sum(["extra"]);
  const { purpose, lineIds, way } = ask.request;
  if (amount === 0) return { purpose: "extra", amount: centsToDecimal(extra), extra: "0.00", way };
  return {
    purpose,
    ...(lineIds === undefined ? {} : { lineIds }),
    amount: centsToDecimal(amount),
    extra: centsToDecimal(extra),
    way,
  };
}

/** The answer for the press `ask` whose rows are `stored` and whose correction's legs are `legs`,
 * the same on its first send and any resend; `refusal` is what refused a part after an earlier one
 * moved money, which only the first send knows. A card refund that was not made refuses by itself. */
async function outcomeOf(
  tx: Transaction,
  deps: GiveBackWriteDeps,
  cfg: DeviceRequestConfig,
  stored: StoredGiveBack,
  ask: GiveBackWrite,
  legs: readonly RefundRow[],
  refusal: WaitReason | null = null,
): Promise<GiveBackOutcome> {
  const answer: GiveBackOutcome["parts"] = ask.expected.map((part) => {
    const amount = centsToDecimal(part.amount);
    if (part.kind === "correction") {
      const row = stored.correction;
      if (row === undefined) return { kind: "correction", amount, state: "not_started" };
      return {
        kind: "correction",
        amount,
        state: row.state === "filed" ? "completed" : row.state === "open" ? "pending" : "failed",
        correctionId: row.id,
      };
    }
    const kind = part.kind as "refund" | "extra";
    const rows = kind === "extra" ? stored.extra : stored.refund;
    if (rows.length === 0) return { kind, amount, state: "not_started" };
    return { kind, amount, state: refundsState(rows), refundId: rows[0]!.id };
  });
  const failed = [...stored.refund, ...stored.extra, ...legs].find((row) => row.state === "failed");
  const declined =
    failed === undefined
      ? null
      : reasonOf(
          new AppError("give_back.refund_failed", {
            refundId: failed.id,
            tenderId: failed.tenderId!,
          }),
        );
  const refused = refusal ?? declined;
  return {
    parts: answer,
    refusal: refused === null ? null : { code: refused.code, params: refused.params ?? {} },
    underWay:
      stored.correction?.state === "open"
        ? await readInvoiceCorrection(tx, deps.backend, cfg, stored.correction.id)
        : null,
    rest: restOf(ask, answer),
  };
}

/** Whether any of `rows` is a reader card's refund, whose press writes its parts one at a time. */
const onReader = (rows: readonly RefundRow[]) =>
  rows.some((row) => row.method === "card" && !row.manual);

/**
 * Checks a resend of the press `ask` against the rows its first send wrote, as each write's own
 * replay checks them: every part it names was written with the same money, reason and cancels,
 * and nothing it does not name was. Writes nothing.
 */
async function checkResend(
  tx: Transaction,
  deps: GiveBackWriteDeps,
  cfg: DeviceRequestConfig,
  reading: TrustedReading,
  saleId: SaleId,
  ask: GiveBackWrite,
  stored: StoredGiveBack,
  legs: readonly RefundRow[],
  personId: string,
): Promise<void> {
  const reused = () => new AppError("submission.id_reused", { submissionId: ask.ids.refund });
  const amountOf = (kind: string) =>
    ask.expected.filter((part) => part.kind === kind).reduce((sum, part) => sum + part.amount, 0);
  const asked = cents(ask.request.amount);
  if (
    ask.request.purpose === "extra"
      ? amountOf("extra") !== asked || ask.expected.some((part) => part.kind !== "extra")
      : amountOf("refund") + amountOf("correction") !== asked ||
        amountOf("extra") !== cents(ask.request.extra)
  )
    throw reused();
  const reason = await reasonTextOf(tx, ask);
  const kinds = new Set(ask.expected.map((part) => part.kind));
  if (
    (stored.refund.length > 0 && !kinds.has("refund")) ||
    (stored.extra.length > 0 && !kinds.has("extra")) ||
    (stored.correction !== undefined && !kinds.has("correction"))
  )
    throw reused();
  const present = ask.expected.map((part) =>
    part.kind === "correction"
      ? stored.correction !== undefined
      : (part.kind === "extra" ? stored.extra : stored.refund).length > 0,
  );
  // Only a reader's press stops between parts, and only ever before all the later ones.
  const missing = present.indexOf(false);
  if (
    missing !== -1 &&
    (!onReader([...stored.refund, ...stored.extra, ...legs]) ||
      present.slice(missing).some(Boolean))
  )
    throw reused();
  for (const [index, part] of ask.expected.entries()) {
    if (!present[index]) continue;
    if (part.kind === "correction") {
      const row = stored.correction!;
      if (
        row.gross !== part.amount ||
        JSON.stringify([...(row.lineIds ?? [])].sort()) !== JSON.stringify(part.lineIds ?? []) ||
        row.reason !== reason
      )
        throw new AppError("submission.id_reused", { submissionId: ask.ids.correction });
      continue;
    }
    const rows = part.kind === "extra" ? stored.extra : stored.refund;
    const field = part.kind === "extra" ? "tipAmount" : "appliedAmount";
    if (rows.reduce((sum, row) => sum + row[field], 0) !== part.amount) throw reused();
    for (const row of rows)
      await reserveTenderRefund(
        tx,
        cfg,
        saleId,
        {
          submissionId: row.submissionId!,
          tenderId: row.tenderId!,
          appliedAmount: centsToDecimal(row.appliedAmount),
          tipAmount: centsToDecimal(row.tipAmount),
          reason,
          ...(row.manual ? { manualConfirmed: true } : {}),
          ...(part.cancellationIds === null ? {} : { cancellationIds: part.cancellationIds }),
        },
        { requestedBy: personId, authorizedBy: row.authorizedBy },
        reading.instant.toISOString(),
        { backend: deps.backend, reading },
      );
  }
}

/** Fills `amount` cents from `payments` in order, each up to what `left` says it holds. */
function fromPayments(
  amount: number,
  payments: readonly RefundableTender[],
  left: (payment: RefundableTender) => number,
): { tenderId: string; cents: number }[] {
  const legs: { tenderId: string; cents: number }[] = [];
  let rest = amount;
  for (const payment of payments) {
    if (rest === 0) break;
    const share = Math.min(rest, left(payment));
    if (share > 0) legs.push({ tenderId: payment.tenderId, cents: share });
    rest -= share;
  }
  if (rest > 0) throw invalid("amount");
  return legs;
}

/** Who gives back, and the supervisor's PIN when one was typed, checked ahead of the transaction. */
export interface GiveBackActor {
  device: DeviceBinding | null;
  authority: PersonAuthority;
  personId: string;
  sessionId: string;
  override?: Override & { checked?: SecretCheck };
  attempts: PinAttempts;
}

/** What the write answers, and the correction the route files once it has committed: a separate
 * terminal's money is already gone, so a refused filing must not undo its record. On a card
 * reader, once the caller's transaction has committed, `onReader` gives every part back and
 * answers. */
export type GiveBackResult =
  | { outcome: GiveBackOutcome; fileAfter: string | null }
  | { onReader: (deps: TenderRefundDeps) => Promise<GiveBackOutcome> };

/** Each of `rights` granted to the signed-in person or the supervisor whose PIN `who` carries,
 * refusing the first neither holds. On a separate terminal the refund also needs a fresh PIN
 * (`confirmManualRefundAuthority`). */
async function authorizeRights(
  tx: Transaction,
  who: GiveBackActor,
  rights: readonly GiveBackRight[],
  manual: { tenderId: string } | null,
): Promise<{ refund?: Authorization; rectify?: Authorization }> {
  const granted: { refund?: Authorization; rectify?: Authorization } = {};
  for (const right of rights) {
    const authorization = await authorize(
      tx,
      { sessionId: who.sessionId, permission: right, override: who.override },
      who.attempts,
    );
    if (right === "sale.rectify") granted.rectify = authorization;
    else
      granted.refund =
        manual === null
          ? authorization
          : await confirmManualRefundAuthority(
              tx,
              authorization,
              who.override,
              who.attempts,
              () =>
                new AppError("tender.manual_refund_pin_required", { tenderId: manual.tenderId }),
            );
  }
  return granted;
}

/** The authority a plain refund the cancel's approval covers is recorded under, as Refund a payment
 * records it: the person, when they hold `sale.refund`, else the cancel's approver. */
function coveredRefundActor(who: GiveBackActor) {
  return async (cancelledBy?: string): Promise<Authorization> => {
    if (holds(who.authority, "sale.refund"))
      return { authorizedBy: who.personId, permission: "sale.refund", viaOverride: false };
    if (cancelledBy === undefined)
      throw new AppError("authorization.not_permitted", { permission: "sale.refund" });
    return {
      authorizedBy: cancelledBy,
      permission: "sale.refund",
      viaOverride: cancelledBy !== who.personId,
    };
  };
}

/** The rights a resend of `ask` needs, worked out from the same body and the rows its first send
 * wrote. Judged from the stored rows, as Refund a payment judges a resend, it can refuse what the
 * first send allowed: a covered refund stored under a person holding `sale.refund` is not covered. */
async function resendRights(
  tx: Transaction,
  ask: GiveBackWrite,
  stored: StoredGiveBack,
  legs: readonly RefundRow[],
  manual: boolean,
): Promise<GiveBackRight[]> {
  const refund = ask.expected.find((part) => part.kind === "refund");
  let refundCovered =
    refund !== undefined &&
    ask.request.fromCancel !== undefined &&
    refund.cancellationIds !== null &&
    sameIds(ask.request.fromCancel, refund.cancellationIds) &&
    cents(ask.request.extra) === 0 &&
    !manual;
  for (const row of refundCovered ? stored.refund : [])
    await authorizeStoredTenderRefund(tx, row, async (cancelledBy) => {
      if (cancelledBy === undefined) refundCovered = false;
      return { authorizedBy: row.authorizedBy, permission: "sale.refund", viaOverride: false };
    });
  return rightsFor({
    refund: refund !== undefined,
    refundCovered,
    extra: ask.expected.some((part) => part.kind === "extra"),
    correction: stored.correction !== undefined,
    leg: legs.length > 0,
  });
}

/** The refunds the press `ask` wrote as its correction's leg. */
async function legsOf(
  tx: Transaction,
  stored: StoredGiveBack,
  ask: GiveBackWrite,
): Promise<RefundRow[]> {
  if (stored.correction === undefined) return [];
  const legs = await readCorrectionLegs(tx, stored.correction.id);
  return legs.refunds.filter((_, index) => legs.requestIds[index] === ask.ids.leg);
}

/**
 * Gives `body` back on the receipt `saleId` (5.3), in the caller's one transaction: the plain
 * refunds of what cancels still owe, the extra, then one correction of the rest with its leg. In
 * cash the correction is filed here once all its money is back, and a refused filing undoes every
 * part; the drawer opens once, on the last cash write. On a separate terminal every refund is
 * recorded completed and the correction is left for the caller to file after commit. The rights
 * asked are the ones the preview works out (5.4, D9). A resend of the same ids answers its first
 * result and writes nothing; parts other than `body.expected` refuse `give_back.changed`.
 */
export async function giveBack(
  tx: Transaction,
  deps: GiveBackWriteDeps,
  cfg: DeviceRequestConfig,
  saleId: SaleId,
  who: GiveBackActor,
  body: object,
): Promise<GiveBackResult> {
  const ask = parseGiveBackWrite(body as Record<string, unknown>);
  const reading = deps.clock.now();
  await requireEconomicWrite(tx, cfg, deps.admission);
  const manualFor = (manual: boolean) => {
    if (!manual) return null;
    if (!ask.manualConfirmed) throw invalid("manualConfirmed");
    return { tenderId: ask.request.way };
  };
  const earlier = await readStoredGiveBack(tx, saleId, ask.ids);
  if (earlier !== undefined) {
    const legs = await legsOf(tx, earlier, ask);
    const manual = [...earlier.refund, ...earlier.extra, ...legs].some((row) => row.manual);
    const rights = await resendRights(tx, ask, earlier, legs, manual);
    await authorizeRights(tx, who, rights, manualFor(manual));
    await checkResend(tx, deps, cfg, reading, saleId, ask, earlier, legs, who.personId);
    return {
      outcome: await outcomeOf(tx, deps, cfg, earlier, ask, legs),
      fileAfter: manual && earlier.correction?.state === "open" ? earlier.correction.id : null,
    };
  }

  const { plan, rights } = await planWithRights(
    tx,
    deps,
    cfg,
    reading,
    saleId,
    who.device,
    ask.request,
  );
  if (partsKey(comparablePartsOf(plan.parts)) !== partsKey(ask.expected))
    throw new AppError("give_back.changed", { saleId });
  const manual = manualFor(plan.manual);
  const reason = await reasonTextOf(tx, ask);
  const granted = await authorizeRights(tx, who, rights, manual);
  const correction = plan.parts.find((part) => part.kind === "correction");
  const leg = correction === undefined ? 0 : cents(correction.amount) - cents(plan.leftUnderWay);

  const payments = (await readRefundableTenders(tx, saleId)).filter((row) =>
    ask.request.way === "cash" ? row.method === "cash" : row.tenderId === ask.request.way,
  );
  const writes = plan.parts.flatMap((part) => {
    if (part.kind === "correction") return [];
    const isExtra = part.kind === "extra";
    const submissionId = isExtra ? ask.ids.extra : ask.ids.refund;
    return fromPayments(cents(part.amount), payments, (payment) =>
      cents(isExtra ? payment.tipRemaining : payment.appliedRemaining),
    ).map((share, index) => ({
      kind: part.kind,
      request: {
        submissionId: partSubmissionId(submissionId, index),
        tenderId: share.tenderId,
        appliedAmount: centsToDecimal(isExtra ? 0 : share.cents),
        tipAmount: centsToDecimal(isExtra ? share.cents : 0),
        reason,
        ...(manual === null ? {} : { manualConfirmed: true }),
        ...(part.kind === "refund" && part.cancellationIds !== undefined
          ? { cancellationIds: part.cancellationIds }
          : {}),
      } satisfies TenderRefundRequest,
    }));
  });
  const refundActor =
    granted.refund === undefined
      ? { requestedBy: who.personId, authorize: coveredRefundActor(who) }
      : { requestedBy: who.personId, authorizedBy: granted.refund.authorizedBy };
  const legRequest = (correctionId: string): TenderRefundRequest => ({
    submissionId: ask.ids.leg,
    tenderId: ask.request.way,
    appliedAmount: centsToDecimal(leg),
    tipAmount: "0.00",
    reason,
    ...(manual === null ? {} : { manualConfirmed: true }),
    invoiceCorrection: { id: correctionId, requestId: ask.ids.leg },
  });
  const open = (into: Transaction, reading: TrustedReading, part: GiveBackPart) =>
    openCorrectionPart(into, deps, cfg, reading, saleId, ask, part, {
      personId: who.personId,
      authorization: granted.rectify!,
    });

  if (!plan.manual && ask.request.way !== "cash")
    return {
      onReader: (refundDeps) =>
        giveBackOnReader(refundDeps, cfg, saleId, ask, {
          personId: who.personId,
          parts: plan.parts.map((part) => ({
            part,
            refund:
              part.kind === "correction"
                ? leg > 0
                  ? (correctionId: string) => ({
                      request: legRequest(correctionId),
                      actor: {
                        requestedBy: who.personId,
                        authorizedBy: granted.refund!.authorizedBy,
                      },
                    })
                  : null
                : () => ({
                    request: writes.find((write) => write.kind === part.kind)!.request,
                    actor: refundActor,
                  }),
          })),
          open,
        }),
    };

  const createdAt = reading.instant.toISOString();
  const manualPaymentRef = async (reserved: RefundRow) =>
    (await captureFor(tx, reserved))!.paymentRef;
  const carry = (reserved: RefundRow, opensDrawer: boolean) =>
    carryNewTenderRefund(
      tx,
      deps,
      cfg.nodeId,
      reading,
      reserved,
      manual !== null
        ? { manualPaymentRef }
        : opensDrawer
          ? {
              openDrawer: (done, printers) =>
                enqueueRefundDrawer(
                  tx,
                  cfg,
                  done.id,
                  who.personId,
                  {
                    authorizedBy: done.authorizedBy,
                    viaOverride: done.authorizedBy !== who.personId,
                  },
                  printers,
                ),
            }
          : {},
    );
  for (const [index, write] of writes.entries()) {
    const { refund: reserved } = await reserveTenderRefund(
      tx,
      cfg,
      saleId,
      write.request,
      refundActor,
      createdAt,
      { backend: deps.backend, reading },
    );
    await carry(reserved, leg === 0 && index === writes.length - 1);
  }
  let fileAfter: string | null = null;
  if (correction !== undefined) {
    const opened = await open(tx, reading, correction);
    if (leg > 0 && manual === null)
      await giveCorrectionCash(
        tx,
        deps,
        cfg,
        opened.correction.id,
        { submissionId: ask.ids.leg, amount: centsToDecimal(leg) },
        {
          personId: who.personId,
          authz: { sessionId: who.sessionId, override: who.override },
          authorization: granted.refund!,
        },
      );
    if (leg > 0 && manual !== null) {
      const { refund: reserved } = await reserveTenderRefund(
        tx,
        cfg,
        saleId,
        legRequest(opened.correction.id),
        { requestedBy: who.personId, authorizedBy: granted.refund!.authorizedBy },
        createdAt,
        { backend: deps.backend, reading },
      );
      await carry(reserved, false);
      fileAfter = opened.correction.id;
    }
  }
  return {
    outcome: await readGiveBackOutcomeOf(tx, deps, cfg, saleId, ask),
    fileAfter,
  };
}

/** Opens the correction `part` of the press `ask`, with the VAT split its preview works out now. */
async function openCorrectionPart(
  tx: Transaction,
  deps: GiveBackWriteDeps,
  cfg: DeviceRequestConfig,
  reading: TrustedReading,
  saleId: SaleId,
  ask: GiveBackWrite,
  part: GiveBackPart,
  actor: { personId: string; authorization: Authorization },
) {
  const lineIds = part.kind === "correction" ? part.lineIds : [];
  const selection = { gross: part.amount, ...(lineIds.length === 0 ? {} : { lineIds }) };
  const split = await previewInvoiceCorrection(tx, deps.backend, cfg, reading, saleId, selection);
  return openInvoiceCorrection(
    tx,
    deps,
    cfg,
    saleId,
    {
      submissionId: ask.ids.correction,
      gross: decimal(part.amount),
      ...(lineIds.length === 0 ? {} : { lineIds }),
      reasonId: ask.reasonId,
      note: ask.note,
      expectedSplit: split.vatBreakdown.map(({ rate, base, tax }) => ({ rate, base, tax })),
    },
    actor,
  );
}

/** One reader part's refund: what it asks for, and who asks and authorizes it. */
type ReaderRefund = {
  request: TenderRefundRequest;
  actor: Parameters<typeof reserveTenderRefund>[4];
};

interface ReaderSequence {
  /** Who gives back; a correction whose leg fails is discarded under their name. */
  personId: string;
  /** In order; a correction's `refund` takes the correction's id, and is null when its leg holds
   * nothing on this card. */
  parts: {
    part: GiveBackPart;
    refund: ((correctionId: string) => ReaderRefund) | null;
  }[];
  open: (
    tx: Transaction,
    reading: TrustedReading,
    part: GiveBackPart,
  ) => ReturnType<typeof openCorrectionPart>;
}

/**
 * Gives the press `ask` back on a card reader (5.3), each part in its own transaction followed by
 * the card company's answer. Splitting the press across transactions is a deliberate decision
 * (CLAUDE.md §3): the card company is asked between parts, and no transaction stays open across its
 * answer. A correction opens in the same transaction as its leg's reservation and is discarded if
 * that leg fails, so a refused card refund never leaves a correction open. A part left pending
 * stops the press, the answer's `rest` naming what was not sent. A part refused after an earlier
 * one moved money answers `refusal` and undoes nothing: that money is already back on the card.
 * A part another send of the same ids already wrote is never carried again (I1).
 */
async function giveBackOnReader(
  deps: TenderRefundDeps,
  cfg: DeviceRequestConfig,
  saleId: SaleId,
  ask: GiveBackWrite,
  sequence: ReaderSequence,
): Promise<GiveBackOutcome> {
  let refusal: WaitReason | null = null;
  for (const [index, step] of sequence.parts.entries()) {
    let settled: { id: string; state: string; correctionId?: string } | null;
    try {
      settled = await readerPart(deps, cfg, saleId, sequence, step);
    } catch (error) {
      if (index === 0 || !(error instanceof AppError)) throw error;
      refusal = reasonOf(error);
      break;
    }
    if (settled === null) break;
    if (settled.correctionId !== undefined && settled.state === "completed")
      await fileCorrectionAutomatically(deps, settled.correctionId).catch((error: unknown) => {
        deps.log?.("error", "invoice_correction.automatic_filing_failed", {
          correctionId: settled.correctionId,
          refundId: settled.id,
          errorCode: codeOf(error),
        });
      });
    if (settled.correctionId !== undefined && settled.state === "failed") {
      const correctionId = settled.correctionId;
      await withTransaction(deps.db, async (tx) => {
        await requireEconomicWrite(tx, cfg, deps.admission);
        await closeInvoiceCorrection(tx, deps, cfg, correctionId, {
          personId: sequence.personId,
        });
      });
    }
    if (settled.state !== "completed") break;
  }
  return withTransaction(deps.db, (tx) =>
    readGiveBackOutcomeOf(tx, deps, cfg, saleId, ask, refusal),
  );
}

/** Writes one reader part in its own transaction, then waits for the card company's answer as
 * Refund a payment does; null when nothing was sent: another send of these ids wrote the part, or
 * the correction's leg holds nothing on this card. */
async function readerPart(
  deps: TenderRefundDeps,
  cfg: DeviceRequestConfig,
  saleId: SaleId,
  sequence: ReaderSequence,
  step: ReaderSequence["parts"][number],
): Promise<{ id: string; state: string; correctionId?: string } | null> {
  let release: (() => void) | undefined;
  try {
    const reserved = await withTransaction(deps.db, async (tx) => {
      await requireEconomicWrite(tx, cfg, deps.admission);
      const reading = deps.clock.now();
      await refuseUntilRefundable(tx, deps.backend, cfg.nodeId, reading);
      let correctionId: string | undefined;
      if (step.part.kind === "correction") {
        const opened = await sequence.open(tx, reading, step.part);
        if (opened.replayed) return null;
        correctionId = opened.correction.id;
      }
      if (step.refund === null) return null;
      const { request, actor } = step.refund(correctionId ?? "");
      const begun = await reserveTenderRefund(
        tx,
        cfg,
        saleId,
        request,
        actor,
        reading.instant.toISOString(),
        { backend: deps.backend, reading },
      );
      if (begun.replayed) return null;
      const carried = await carryNewTenderRefund(tx, deps, cfg.nodeId, reading, begun.refund, {
        beforeCompletion: (refund) => refuseUnlessProviderRefunds(tx, deps, refund),
      });
      release = claimTenderRefund(deps.db, carried.id);
      return { id: carried.id, correctionId };
    });
    if (reserved === null) return null;
    const held = release!;
    release = undefined;
    const settled = await resolveClaimedTenderRefund(deps, reserved.id, "retry", held);
    return {
      id: settled.id,
      state: settled.state,
      ...(reserved.correctionId === undefined ? {} : { correctionId: reserved.correctionId }),
    };
  } catch (error) {
    release?.();
    throw error;
  }
}

async function readGiveBackOutcomeOf(
  tx: Transaction,
  deps: GiveBackWriteDeps,
  cfg: DeviceRequestConfig,
  saleId: SaleId,
  ask: GiveBackWrite,
  refusal: WaitReason | null = null,
): Promise<GiveBackOutcome> {
  const stored = (await readStoredGiveBack(tx, saleId, ask.ids))!;
  return outcomeOf(tx, deps, cfg, stored, ask, await legsOf(tx, stored, ask), refusal);
}

/** What the press `body` wrote on `saleId` answers now, as its write answered it. Writes nothing. */
export function readGiveBackOutcome(
  tx: Transaction,
  deps: GiveBackWriteDeps,
  cfg: DeviceRequestConfig,
  saleId: SaleId,
  body: object,
): Promise<GiveBackOutcome> {
  return readGiveBackOutcomeOf(
    tx,
    deps,
    cfg,
    saleId,
    parseGiveBackWrite(body as Record<string, unknown>),
  );
}
