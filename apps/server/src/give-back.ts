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
import { payments } from "@waitron/payments";
import {
  addDecimal,
  AppError,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  sumDecimals,
  thousandthsToDecimal,
  type Decimal,
  type SaleId,
} from "@waitron/shared";
import type { RefundProviderFor } from "./bill-refunds.js";
import { filedFamilyOf, isFree, pairFiling, readBillFiling } from "./cancellation-refund-value.js";
import { assertTakesTender, type DeviceBinding } from "./device-session.js";
import { correctionOpenRefusal, openCorrectionOf } from "./invoice-correction-legs.js";
import {
  readCorrectableNow,
  readInvoiceCorrection,
  type InvoiceCorrectionView,
} from "./invoice-corrections.js";
import { matchTenderRefundCapture } from "./tender-refund-capture.js";
import { refuseUntilRefundable } from "./tender-refund-completion.js";
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
 * `readCorrectableNow` answered. */
export async function giveBackWaits(
  tx: Transaction,
  deps: GiveBackDeps,
  cfg: DeviceRequestConfig,
  reading: TrustedReading,
  saleId: SaleId,
  read: { openCorrectionId: string | undefined; correctionWaiting: AppError | null },
): Promise<GiveBackWaits> {
  const all = await waitOf(async () => {
    await requireEconomicWrite(tx, cfg, deps.admission);
    if (read.openCorrectionId !== undefined)
      throw correctionOpenRefusal(saleId, read.openCorrectionId);
    await refuseUntilRefundable(tx, deps.backend, cfg.nodeId, reading);
  });
  if (all !== null) return { all, correction: null };
  return {
    all,
    correction: read.correctionWaiting === null ? null : reasonOf(read.correctionWaiting),
  };
}

/** Whether `line` can be ticked now: never with no money left to give back, and while a
 * corrective waits only for what its cancel still owes. */
export function lineAvailability(
  line: Pick<GiveBackLine, "left" | "cancelled">,
  waits: GiveBackWaits,
  moneyLeft: boolean,
): Availability {
  if (waits.all !== null) return { available: false, reason: waits.all };
  if (!moneyLeft) return { available: false, reason: null };
  const open = waits.correction === null ? line.left : (line.cancelled?.owed ?? "0.00");
  if (positive(decimal(open))) return { available: true, reason: null };
  return { available: false, reason: waits.correction };
}

/** Whether each choice can be used now, from the lines and ways already worked out. */
export function choiceAvailability(
  lines: readonly Availability[],
  ways: readonly Pick<GiveBackWay, "moneyLeft" | "extraLeft" | "pending" | "reason">[],
  waits: GiveBackWaits,
): Record<GiveBackPurpose, Availability> {
  if (waits.all !== null) {
    const closed = { available: false, reason: waits.all };
    return { dishes: closed, goodwill: closed, extra: closed };
  }
  const moneyLeft = positive(sumDecimals(ways.map((way) => decimal(way.moneyLeft))));
  const nothing = { available: false, reason: null };
  const dishes = lines.some((line) => line.available)
    ? { available: true, reason: null }
    : moneyLeft
      ? { available: false, reason: waits.correction }
      : nothing;
  const goodwill = !moneyLeft
    ? nothing
    : waits.correction !== null
      ? { available: false, reason: waits.correction }
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
  const free = new Set<string>();
  const [sale] = await tx
    .select({ workingOrderId: sales.workingOrderId })
    .from(sales)
    .where(eq(sales.id, saleId));
  if (sale?.workingOrderId == null) return { cancelled, free };
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
    }
  }
  return { cancelled, free };
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
  const readers = refundable.filter((row) => row.method === "card" && !row.manual);
  if (readers.length === 0) return new Set();
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
  const refused = new Set<string>();
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
  const correctable = await readCorrectableNow(tx, deps.backend, cfg, reading, saleId, () => false);
  const openCorrectionId = await openCorrectionOf(tx, saleId);
  const waits = await giveBackWaits(tx, deps, cfg, reading, saleId, {
    openCorrectionId,
    correctionWaiting: correctable.waiting,
  });
  const ways = waysOf(
    correctable.tenders,
    device,
    await readersThatCannotRefund(tx, deps, saleId, correctable.tenders),
  );
  const moneyLeft = ways.some((way) => positive(decimal(way.moneyLeft)));
  const { lines: filed, toLine } = await receiptLines(tx, saleId);
  const { cancelled, free } = await cancelsAndFreeByLine(tx, saleId, toLine);
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
    return { ...view, ...lineAvailability(view, waits, moneyLeft) };
  });
  return {
    lines,
    ways,
    underWay:
      openCorrectionId === undefined
        ? null
        : await readInvoiceCorrection(tx, deps.backend, cfg, openCorrectionId),
    choices: choiceAvailability(lines, ways, waits),
  };
}
