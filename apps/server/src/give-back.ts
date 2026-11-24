import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { readCancelsForRefund } from "@waitron/adjustments";
import { correctionTargetFor } from "@waitron/core";
import {
  adjustments,
  saleLines,
  sales,
  tenders as tenderRows,
  type Transaction,
} from "@waitron/db";
import type { FiscalBackend, TrustedReading } from "@waitron/fiscal";
import { holds, type PersonAuthority } from "@waitron/identity";
import { payments } from "@waitron/payments";
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
import { correctionOpenRefusal, openCorrectionOf } from "./invoice-correction-legs.js";
import {
  readCorrectableNow,
  readInvoiceCorrection,
  recordsNeedChecking,
  type InvoiceCorrectionView,
} from "./invoice-corrections.js";
import { matchTenderRefundCapture } from "./tender-refund-capture.js";
import { refuseUntilRefundable } from "./tender-refund-completion.js";
import {
  allocateToCancels,
  cancelsStillOwedBy,
  isPartPayment,
  moneyCents,
} from "./tender-refund-reservation.js";
import type { RefundableTender } from "./tender-refund-types.js";
import { sendsRefunds } from "./tender-refunds.js";
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
  /** Stops all payment money: a part payment's ticket Correct invoice can never take, whose plain
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
    read.correctable === 0 &&
    read.correctionWaiting === null &&
    tenderId !== undefined &&
    (await isPartPayment(tx, saleId))
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
  const extra = withExtra.some((way) => !way.pending)
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

/** What the refund write will ask of a reader card's capture: whether its provider sends refunds
 * at all, takes part refunds, and the capture's amount in cents (case 8). */
interface ReaderCapture {
  sends: boolean;
  partialRefund: boolean;
  amount: number;
}

/** {@link ReaderCapture} for each reader-card tender of `refundable`, as the refund write finds
 * the capture and asks the provider. */
async function readerCaptures(
  tx: Transaction,
  deps: GiveBackDeps,
  saleId: SaleId,
  refundable: readonly RefundableTender[],
): Promise<Map<string, ReaderCapture>> {
  const found = new Map<string, ReaderCapture>();
  const readers = refundable.filter((row) => row.method === "card" && !row.manual);
  if (readers.length === 0) return found;
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
    found.set(reader.tenderId, {
      sends: capture !== undefined && sendsRefunds(provider, capture.provider),
      partialRefund: provider?.capabilities.partialRefund === true,
      amount: capture?.amount ?? 0,
    });
  }
  return found;
}

function waysOf(
  refundable: readonly RefundableTender[],
  device: DeviceBinding | null,
  readers: ReadonlyMap<string, ReaderCapture>,
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
          : readers.get(first.tenderId)?.sends === false
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
  readers: ReadonlyMap<string, ReaderCapture>;
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
  const waits = await giveBackWaits(tx, deps, cfg, reading, saleId, {
    openCorrectionId,
    correctionWaiting: correctable.waiting,
    correctable: correctable.amounts.correctable,
    tenderId: correctable.tenders.find((row) => positive(decimal(row.appliedRemaining)))?.tenderId,
  });
  const readers = await readerCaptures(tx, deps, saleId, correctable.tenders);
  const ways = waysOf(correctable.tenders, device, readers);
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
    readers,
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
  const request = parseGiveBackRequest(body as Record<string, unknown>);
  const facts = await readFacts(tx, deps, cfg, reading, saleId, who.device);
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
  assertTakesTender(who.device, tenderKind(tenders[0]!));
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
      facts.correctable > 0 && !(await recordsNeedChecking(tx, deps.backend, cfg.nodeId))
        ? facts.correctable
        : 0;
    if (correctable === 0) {
      refund += rest;
      rest = 0;
    } else {
      const usable = view.ways.filter((row) => row.reason === null);
      if (rest > sumCents(usable.map((row) => row.moneyLeft)) - refund) throw invalid("amount");
      // Opening it shares the rest over the lines, which refuse more than they hold.
      if (rest > correctable) throw new AppError("sale.correction_amount_invalid", {});
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

  const legs = [refund, extra, rest - leftUnderWay].filter((part) => part > 0);
  const reader = facts.readers.get(tenders[0]!.tenderId);
  if (reader !== undefined && !reader.partialRefund && legs.some((part) => part !== reader.amount))
    throw new AppError("tender.refund_unavailable", { tenderId: tenders[0]!.tenderId });

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

  const needed = new Set<GiveBackRight>();
  if (refund > 0 && !(await coveredByCancel(tx, saleId, request, cancellationIds, refund, way)))
    needed.add("sale.refund");
  if (extra > 0) needed.add("sale.refund");
  if (correction !== undefined) {
    needed.add("sale.rectify");
    if (rest - leftUnderWay > 0) needed.add("sale.refund");
  }
  return {
    parts,
    leftUnderWay: centsToDecimal(leftUnderWay),
    needs: (["sale.refund", "sale.rectify"] as const).filter(
      (right) => needed.has(right) && !holds(who.authority, right),
    ),
    manual: way.manual,
  };
}
