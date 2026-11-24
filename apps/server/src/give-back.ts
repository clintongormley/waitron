import { and, asc, eq, ne, or, isNull } from "drizzle-orm";
import { readCancelsForRefund } from "@waitron/adjustments";
import { readCorrectableLines, type CorrectableLine } from "@waitron/core";
import { adjustments, saleLines, sales, type Transaction } from "@waitron/db";
import type { FiscalBackend, TrustedReading } from "@waitron/fiscal";
import {
  addDecimal,
  AppError,
  centsToDecimal,
  compareDecimal,
  decimal,
  subtractDecimal,
  sumDecimals,
  thousandthsToDecimal,
  type Decimal,
  type SaleId,
} from "@waitron/shared";
import { filedDishRowOf, isFree, readBillFiling } from "./cancellation-refund-value.js";
import { assertTakesTender, type DeviceBinding } from "./device-session.js";
import { openCorrectionOf, refuseWhileCorrectionOpen } from "./invoice-correction-legs.js";
import {
  correctableNow,
  readInvoiceCorrection,
  type InvoiceCorrectionView,
} from "./invoice-corrections.js";
import { readRefundableTenders } from "./tender-refund-balance.js";
import { refuseUntilRefundable } from "./tender-refund-completion.js";
import type { RefundableTender } from "./tender-refund-types.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import { requireEconomicWrite, type TradingAdmission } from "./trading-admission.js";
import "./errors.js";

/** The code (and params) the write would answer. */
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
  /** The cancels on this line with Refund ticked. */
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
}

const ZERO = decimal("0.00");
const positive = (value: Decimal) => compareDecimal(value, ZERO) > 0;

async function waitOf(check: () => Promise<unknown>): Promise<WaitReason | null> {
  try {
    await check();
    return null;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return { code: error.code, params: { ...error.params } };
  }
}

/** What makes a give-back on `saleId` wait now, from the checks the write runs: `all` stops every
 * choice (cases 4–7); `correction` stops money that needs a corrective (cases 1 and 2), and is not
 * read while `all` holds. */
export async function giveBackWaits(
  tx: Transaction,
  deps: GiveBackDeps,
  cfg: DeviceRequestConfig,
  reading: TrustedReading,
  saleId: SaleId,
): Promise<{ all: WaitReason | null; correction: WaitReason | null }> {
  const all = await waitOf(async () => {
    await requireEconomicWrite(tx, cfg, deps.admission);
    await refuseWhileCorrectionOpen(tx, saleId);
    await refuseUntilRefundable(tx, deps.backend, cfg.nodeId, reading);
  });
  if (all !== null) return { all, correction: null };
  const correction = await waitOf(() =>
    correctableNow(tx, deps.backend, cfg, reading, saleId, () => false),
  );
  return { all, correction };
}

/** Whether `line` can be ticked now: while a corrective waits, only for what its cancel still
 * owes. */
export function lineAvailability(
  line: Pick<GiveBackLine, "left" | "cancelled">,
  waits: { all: WaitReason | null; correction: WaitReason | null },
): Availability {
  if (waits.all !== null) return { available: false, reason: waits.all };
  const open = waits.correction === null ? line.left : (line.cancelled?.owed ?? "0.00");
  if (positive(decimal(open))) return { available: true, reason: null };
  return { available: false, reason: waits.correction };
}

/** Whether each choice can be used now, from the lines and ways already worked out. */
export function choiceAvailability(
  lines: readonly Availability[],
  ways: readonly Pick<GiveBackWay, "moneyLeft" | "extraLeft" | "pending" | "reason">[],
  waits: { all: WaitReason | null; correction: WaitReason | null },
): Record<GiveBackPurpose, Availability> {
  if (waits.all !== null) {
    const closed = { available: false, reason: waits.all };
    return { dishes: closed, goodwill: closed, extra: closed };
  }
  const dishes = lines.some((line) => line.available)
    ? { available: true, reason: null }
    : { available: false, reason: waits.correction };
  const money = sumDecimals(ways.map((way) => decimal(way.moneyLeft)));
  const goodwill =
    waits.correction !== null
      ? { available: false, reason: waits.correction }
      : { available: positive(money), reason: null };
  const withExtra = ways.filter((way) => positive(decimal(way.extraLeft)));
  const extra = withExtra.some((way) => !way.pending)
    ? { available: true, reason: null }
    : { available: false, reason: withExtra[0]?.reason ?? null };
  return { dishes, goodwill, extra };
}

async function readCancelsOf(tx: Transaction, workingOrderId: string | null) {
  if (workingOrderId === null) return [];
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

/** The receipt's lines with each one's cancels with Refund ticked and whether it was given free,
 * keyed by filed line id. */
async function cancelsAndFreeByLine(tx: Transaction, saleId: SaleId) {
  const [sale] = await tx
    .select({ workingOrderId: sales.workingOrderId })
    .from(sales)
    .where(eq(sales.id, saleId));
  const cancelled = new Map<string, { quantity: Decimal; owed: Decimal; back: Decimal }>();
  const free = new Set<string>();
  const workingOrderId = sale?.workingOrderId ?? null;
  if (workingOrderId === null) return { cancelled, free };
  const filing = await readBillFiling(tx, workingOrderId, saleId);
  for (const line of filing.stored.filter(isFree)) {
    const row = filedDishRowOf(filing, line.id);
    if (row !== undefined) free.add(row);
  }
  for (const cancel of await readCancelsOf(tx, workingOrderId)) {
    if (cancel.lineId === null || cancel.refundValue === null) continue;
    const row = filedDishRowOf(filing, cancel.lineId);
    if (row === undefined) continue;
    const before = cancelled.get(row) ?? { quantity: decimal("0.000"), owed: ZERO, back: ZERO };
    const owed = subtractDecimal(cancel.refundValue, cancel.linked);
    cancelled.set(row, {
      quantity: addDecimal(before.quantity, cancel.quantity ?? decimal("0.000")),
      owed: addDecimal(before.owed, positive(owed) ? owed : ZERO),
      back: addDecimal(before.back, cancel.linked),
    });
  }
  return { cancelled, free };
}

/** The receipt's lines as Correct invoice reads them, or as filed where it refuses the receipt. */
async function receiptLines(
  tx: Transaction,
  backend: FiscalBackend,
  cfg: Pick<DeviceRequestConfig, "nodeId">,
  saleId: SaleId,
): Promise<(Omit<CorrectableLine, "rate"> & { quantity: Decimal })[]> {
  const filed = await tx
    .select({
      id: saleLines.id,
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
  let correctable: Map<string, Decimal> | undefined;
  try {
    const lines = await readCorrectableLines(tx, backend, saleId, cfg.nodeId);
    correctable = new Map(lines.map((line) => [line.id, line.left]));
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
  }
  return filed.map((line) => {
    const gross = centsToDecimal(line.lineGross ?? 0);
    return {
      id: line.id,
      descriptions: line.descriptions,
      quantity: thousandthsToDecimal(line.quantity),
      gross,
      left: correctable?.get(line.id) ?? gross,
    };
  });
}

function takesHere(device: DeviceBinding | null, tender: RefundableTender): boolean {
  try {
    assertTakesTender(
      device,
      tender.method === "cash" ? "cash" : tender.manual ? "hand-keyed-card" : "reader-card",
    );
    return true;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return false;
  }
}

function waysOf(tenders: readonly RefundableTender[], device: DeviceBinding | null): GiveBackWay[] {
  const cash = tenders.filter((tender) => tender.method === "cash");
  const groups = [
    ...(cash.length === 0 ? [] : [{ way: "cash", tenders: cash }]),
    ...tenders
      .filter((tender) => tender.method === "card")
      .map((tender) => ({ way: tender.tenderId, tenders: [tender] })),
  ];
  return groups.map(({ way, tenders: group }) => {
    const pending = group.find((tender) => tender.pendingRefundId !== null);
    return {
      way,
      last4: group[0]!.last4,
      manual: group[0]!.manual,
      moneyLeft: sumDecimals(group.map((tender) => decimal(tender.appliedRemaining))),
      extraLeft: sumDecimals(group.map((tender) => decimal(tender.tipRemaining))),
      pending: pending !== undefined,
      allowedHere: takesHere(device, group[0]!),
      reason:
        pending === undefined
          ? null
          : { code: "tender.refund_in_progress", params: { tenderId: pending.tenderId } },
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
  const tenders = await readRefundableTenders(tx, saleId);
  const waits = await giveBackWaits(tx, deps, cfg, reading, saleId);
  const { cancelled, free } = await cancelsAndFreeByLine(tx, saleId);
  const lines = (await receiptLines(tx, deps.backend, cfg, saleId)).map((line) => {
    const cancel = cancelled.get(line.id);
    const left = subtractDecimal(line.left, cancel?.back ?? ZERO);
    const view = {
      id: line.id,
      descriptions: line.descriptions,
      quantity: line.quantity,
      gross: line.gross,
      left: positive(left) ? left : ZERO,
      cancelled: cancel ?? null,
      givenFree: free.has(line.id),
    };
    return { ...view, ...lineAvailability(view, waits) };
  });
  const ways = waysOf(tenders, device);
  const correctionId = await openCorrectionOf(tx, saleId);
  return {
    lines,
    ways,
    underWay:
      correctionId === undefined
        ? null
        : await readInvoiceCorrection(tx, deps.backend, cfg, correctionId),
    choices: choiceAvailability(lines, ways, waits),
  };
}
