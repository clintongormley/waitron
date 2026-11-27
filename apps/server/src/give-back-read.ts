import type { Transaction } from "@waitron/db";
import type { FiscalBackend, TrustedReading } from "@waitron/fiscal";
import {
  AppError,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  sumDecimals,
  type ErrorCode,
  thousandthsToDecimal,
  type Decimal,
  type SaleId,
} from "@waitron/shared";
import { refusePlainRefundOfAdvance } from "./advance-taken-off.js";
import type { RefundProviderFor } from "./bill-refunds.js";
import { cancelsAndFreeByLine, receiptLines } from "./cancelled-lines.js";
import { assertTakesTender, type DeviceBinding } from "./device-session.js";
import { correctionOpenRefusal, openCorrectionOf } from "./invoice-correction-legs.js";
import {
  readCorrectableNow,
  readInvoiceCorrection,
  recordsNeedChecking,
  type InvoiceCorrectionView,
} from "./invoice-corrections.js";
import { refuseUntilRefundable } from "./tender-refund-completion.js";
import { isPartPayment } from "./tender-refund-reservation.js";
import type { RefundableTender } from "./tender-refund-types.js";
import { capturesFor, sendsRefunds } from "./tender-refunds.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import { requireEconomicWrite, type TradingAdmission } from "./trading-admission.js";

/** The code (and params) the write would answer. Params stay as the refusal carries them: some
 * codes' params hold lists (`invoice_correction.money_short`'s invoice numbers). */
export interface WaitReason {
  code: ErrorCode;
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
   * `cancelled.back`; never below 0. A cancelled dish's line counts its extras' lines too. */
  left: string;
  /** The cancels with Refund ticked on this dish, its priced extras included: a cancel's money is
   * owed for the dish and its extras together, so they are one selection. `waiting` is the part
   * of `back` a card refund still waits on the card company for. */
  cancelled: { quantity: string; owed: string; back: string; waiting: string } | null;
  /** The cancels on this dish whose money is not all given back yet: those a give-back of the
   * dish names, and the ones `fromCancel` must equal for the cancels' approval to cover it (D9). */
  cancelIds: string[];
  /** The cancelled dish's line this extra's line is given back with; such a line is never ticked
   * itself, and its `left` is counted on the dish's. */
  partOf: string | null;
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

export function reasonOf(error: AppError): WaitReason {
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
 * ({@link moneyAvailability}), and while a corrective waits only for what its cancel still owes,
 * which on a full invoice is the corrective's too (D5). */
export function lineAvailability(
  line: Pick<GiveBackLine, "left" | "cancelled">,
  waits: GiveBackWaits,
  money: Availability,
  fullInvoice: boolean,
): Availability {
  if (waits.all !== null) return { available: false, reason: waits.all };
  if (!money.available) return money;
  if (waits.money !== null) return { available: false, reason: waits.money };
  const open =
    waits.correction === null ? line.left : fullInvoice ? "0.00" : (line.cancelled?.owed ?? "0.00");
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

export function tenderKind(tender: RefundableTender) {
  return tender.method === "cash" ? "cash" : tender.manual ? "hand-keyed-card" : "reader-card";
}

/** The refusal the preview answers for giving back `tender` on `device`, or null where it takes it. */
function refusedHere(device: DeviceBinding | null, tender: RefundableTender): WaitReason | null {
  try {
    assertTakesTender(device, tenderKind(tender));
    return null;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return reasonOf(error);
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
  const captures = await capturesFor(
    tx,
    saleId,
    readers.map((row) => row.tenderId),
  );
  for (const reader of readers) {
    const capture = captures.get(reader.tenderId);
    const provider =
      capture === undefined ? undefined : await deps.refundProviderFor?.(capture.provider);
    if (capture === undefined || !sendsRefunds(provider, capture.provider))
      refused.add(reader.tenderId);
  }
  return refused;
}

/** Each way, and the reason it cannot be used on this device: its own `reason`, else the device's
 * refusal, as the preview checks them in that order. */
function waysOf(
  refundable: readonly RefundableTender[],
  device: DeviceBinding | null,
  cannotRefund: ReadonlySet<string>,
): { way: GiveBackWay; here: WaitReason | null }[] {
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
    const refused = refusedHere(device, first);
    const reason: WaitReason | null =
      pending !== undefined
        ? { code: "tender.refund_in_progress", params: { tenderId: pending.tenderId } }
        : cannotRefund.has(first.tenderId)
          ? { code: "tender.refund_unavailable", params: { tenderId: first.tenderId } }
          : null;
    const view = {
      way,
      last4: first.last4,
      manual: first.manual,
      moneyLeft: sumDecimals(group.map((tender) => decimal(tender.appliedRemaining))),
      extraLeft: sumDecimals(group.map((tender) => decimal(tender.tipRemaining))),
      pending: pending !== undefined,
      allowedHere: refused === null,
      reason,
    };
    return { way: view, here: reason ?? refused };
  });
}

/** The read, with what the routing works from beside it. */
interface GiveBackFacts {
  view: GiveBackView;
  waits: GiveBackWaits;
  tenders: RefundableTender[];
  /** What Correct invoice could give back now, in cents, before the records are checked. */
  correctable: number;
  /** Whether the corrective is a full invoice's, which takes the cancels' money too (D5). */
  fullInvoice: boolean;
  /** The cancels on each line whose money is not all given back yet. */
  cancelIds: ReadonlyMap<string, readonly string[]>;
  /** The lines a correction names for each ticked line: a cancelled dish's family, those of its
   * lines Correct invoice still holds money on. */
  namedFor: (lineId: string) => string[];
  recordsUnchecked: () => Promise<boolean>;
}

export async function readFacts(
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
  const waysHere = waysOf(
    correctable.tenders,
    device,
    await readersThatCannotRefund(tx, deps, saleId, correctable.tenders),
  );
  const ways = waysHere.map(({ way }) => way);
  // What this device can give back: a way it cannot use counts as held, with the preview's code.
  const usableHere = waysHere.map(({ way, here }) => ({ ...way, reason: here }));
  const money = moneyAvailability(usableHere);
  const { lines: filed, toLine } = await receiptLines(tx, saleId);
  const { cancelled, cancelIds, members, partOf, free, filedBack } = await cancelsAndFreeByLine(
    tx,
    saleId,
    toLine,
  );
  const correctableLeft = new Map(correctable.lines?.map((line) => [line.id, line.left]));
  const grossOf = new Map(filed.map((line) => [line.id, line.lineGross ?? 0]));
  const leftOf = (id: string) =>
    decimalToCents(correctableLeft.get(id) ?? centsToDecimal(grossOf.get(id) ?? 0));
  const familyOf = (id: string) => [...(members.get(id) ?? [id])];
  // A filed corrective's legs paid what it took off the dish, so the lines' `left` already counts
  // their links; the gross, read where the lines cannot be, counts none.
  const linesRead = correctable.lines !== null;
  const lines = filed.map((line) => {
    const cancel = cancelled.get(line.id);
    const dish = partOf.get(line.id);
    const rest =
      familyOf(line.id).reduce((total, id) => total + leftOf(id), 0) -
      decimalToCents(cancel?.back ?? ZERO) +
      (linesRead ? (filedBack.get(line.id) ?? 0) : 0);
    const left = dish === undefined ? Math.max(0, rest) : 0;
    const view = {
      id: line.id,
      descriptions: line.descriptions,
      quantity: thousandthsToDecimal(line.quantity),
      gross: centsToDecimal(line.lineGross ?? 0),
      left: centsToDecimal(left),
      cancelled:
        cancel === undefined
          ? null
          : correctable.fullInvoice
            ? { ...cancel, owed: centsToDecimal(Math.min(decimalToCents(cancel.owed), left)) }
            : cancel,
      cancelIds: [...(cancelIds.get(line.id) ?? [])],
      partOf: dish ?? null,
      givenFree: free.has(line.id),
    };
    return {
      ...view,
      ...(dish === undefined
        ? lineAvailability(view, waits, money, correctable.fullInvoice)
        : { available: false, reason: null }),
    };
  });
  return {
    view: {
      lines,
      ways,
      underWay:
        openCorrectionId === undefined
          ? null
          : await readInvoiceCorrection(tx, deps.backend, cfg, openCorrectionId),
      choices: choiceAvailability(lines, usableHere, waits),
    },
    waits,
    tenders: correctable.tenders,
    correctable: correctable.amounts.correctable,
    fullInvoice: correctable.fullInvoice,
    cancelIds,
    namedFor: (lineId) => familyOf(lineId).filter((id) => leftOf(id) > 0),
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
