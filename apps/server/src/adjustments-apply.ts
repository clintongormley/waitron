import type { TillSaleResult } from "./till-sale.js";
import { requireEconomicWrite, type TradingAdmission } from "./trading-admission.js";
import { eq, inArray, sql } from "drizzle-orm";
import {
  adjustmentLines,
  approves,
  evaluateCancel,
  evaluateComp,
  floorAllowance,
  findAdjustmentReason,
  isPercentBp,
  percentReduction,
  policySnapshotOf,
  readAdjustmentSettings,
  readReasonStanding,
  recordAdjustment,
  spreadBillDiscount,
  standingOff,
  type AdjustmentAction,
  type AdjustmentReason,
  type AdjustmentSplit,
  type AdjustmentStage,
  type AdjustmentVerdict,
  type DishPrice,
  type Approval,
  type CompAction,
  type PricedRow,
  type SpreadLine,
  type SpreadResult,
} from "@waitron/adjustments";
import { staffPresentationName } from "@waitron/menu";
import { insertInChunks, workingOrderLines } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  persons,
  readPersonAuthority,
  verifyThrottledCredential,
  type Override,
  type PinAttempts,
} from "@waitron/identity";
import {
  addDecimal,
  AppError,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  decimalToThousandths,
  divideDecimal,
  MONEY_SCALE,
  multiplyDecimal,
  subtractDecimal,
  sumDecimals,
  thousandthsToDecimal,
  toScale,
  type Decimal,
} from "@waitron/shared";
import {
  canonical,
  familyAt,
  gross,
  listValue,
  readRows,
  stageOf,
  standInRow,
  wireApproval,
  type Row,
  type StandIn,
  type WireApproval,
} from "./adjustment-rows.js";
import { invalid, money } from "./bill-allocation.js";
import { runServiceCommand } from "./parties.js";
import { requireOrderBillEditor, parseBillEditExpected } from "./bill-editing.js";
import type { BillEditExpected } from "./order-drafts.js";
import type { TradingContext } from "./trading-context.js";
import { splitLinesWithinOrder, type SplitRow } from "./working-order-transfer.js";
import {
  partyAfterEdit,
  quantityOfLine,
  regroupDropOfRemoval,
  removeFromLine,
  removePortions,
  type VoidTarget,
} from "./working-order-removal.js";
import { bumpRevision, refusePaymentInFlight } from "./working-order-edit-state.js";
import { billTotalOf } from "./adjustment-bill-total.js";
import { atReleasedPrices, regroupAdjusted, releaseDishes } from "./set-menu-dish-release.js";
import {
  assertTabOpen,
  readLockedLines,
  refuseOrderOverSimplifiedLimit,
  totalBeforeEdit,
} from "./stored-order-lines.js";
import {
  captureOrderEdit,
  type OrderAttendance,
  readOrderRevision,
} from "./working-order-context.js";
import { readPortionBindings, readWholePortionLines } from "./order-portions.js";
import { readLineCancellations, serviceQuantities } from "./line-service-state.js";
import "./errors.js";

/** What an adjustment asks, as a preview and an apply share it. */
export interface AdjustmentAsk {
  expectedEdit: BillEditExpected | null;
  orderId: string;
  /** The bill's revision as the caller read it (plan D19). */
  expectedRevision: number;
  /** The dish, or the extra, the action names; null for a discount on the whole bill. */
  lineId: string | null;
  /** Every portion line of one till row, `lineId` among them (plan D31). */
  lineIds?: string[];
  reasonId: string;
  action: AdjustmentAction;
  /** How much of the line; absent for all of it. An extra is taken only whole. */
  quantity?: string;
  percentBp?: number;
  amount?: Decimal;
  note: string | null;
  operatorId: string;
}

export interface AdjustmentArgs extends AdjustmentAsk {
  submissionId: string;
  /** The waiter's answer; true marks every void notice of the family started. */
  preparationStarted?: boolean;
  /** What a cancel row records as started; unlike `preparationStarted`, it touches no notice. */
  recordedPreparationStarted?: boolean;
  /** Someone the plan's approval admits ({@link approves}). */
  approver?: CheckedApprover;
}

/** An approver's PIN as a request carries it. */
export type ApproverPin = Pick<Override, "personId" | "pin">;

/**
 * An approver's PIN with the wrong-PIN limit it counts against, so `applyAdjustment` and
 * `cancelItem` never check an approver's PIN without one.
 */
export type CheckedApprover = Override & { attempts: PinAttempts };

/** What an adjustment would do, answered before it is confirmed (plan D4, D15). */
export interface AdjustmentPreview {
  /** What the bill actually loses, which can differ from what a discount asked for. */
  reduction: string;
  nominalValue: string;
  /** Whose PIN it needs, or null when the operator may apply it alone. */
  needsApproval: WireApproval | null;
  /** The bill's total now and once the action is applied, its set menus worked out again. */
  billTotal: { before: string; after: string };
  /** Each line the action changes: what it loses, and the rows the changed part becomes. */
  lines: {
    lineId: string;
    lineNo: number;
    reduction: string;
    rows: { quantity: string; unitGross: string }[];
  }[];
}

/** New prices for one row, or for the part of it split off with the part of its dish covered when
 * `carved`; a second row in `rows` is split off that one in turn. */
interface Change {
  row: Row;
  carved: boolean;
  rows: PricedRow[];
  reduction: Decimal;
}

/** The part of a dish a comp or a discount covers, split off with its extras before the prices
 * change. */
interface Carve {
  lineNo: number;
  quantity: number;
}

export interface Plan {
  reason: AdjustmentReason;
  reasonName: string;
  maxBillComp: Decimal | null;
  /** Every line of the bill as {@link readRows} read it, before any dish was released. */
  rows: readonly Row[];
  /** The dish or the extra the action names; null on a bill-level discount. */
  line: Row | null;
  /** The part of the line covered, in thousandths; null on a bill-level discount. */
  covered: number | null;
  /** A cancel's quantity taken off the dish, null for all of it. */
  removed: number | null;
  /** On a row, the dish portions a cancel takes whole. */
  removedPortions: Row[] | null;
  carve: Carve | null;
  /** The prices the action sets, on the line, or on a row's stand-in lines (plan D32). */
  changes: Change[];
  /** What is written: `changes`, or on a row, each of its portions' share of them. */
  writes: Change[];
  /** On a row, every line of each stand-in line the action prices, taken or not: each gets its list
   * price, as one grouped line does before part of it is carved off (plan D32). */
  stamped: string[];
  /** The dishes among `writes` read at their a la carte price and written out of their set menus
   * (D31); one the action takes nothing off can be grouped straight back in. */
  released: string[];
  /** On a row, the split one grouped line's second price would record (plan D33). */
  rowSplits: AdjustmentSplit[];
  reduction: Decimal;
  nominal: Decimal;
  before: Decimal;
  stage: AdjustmentStage | null;
  approval: Approval | null;
}

const ZERO = decimal("0");

/** The line as `removeFromLine` takes it, from the row the plan read. */
function voidTargetOf(line: Row): VoidTarget {
  return {
    id: line.id,
    parentLineId: line.parentLineId,
    groupId: line.groupId,
    quantity: line.quantity,
    unitPrecision: line.unitPrecision,
    unitPriceGross: line.unit,
    ticketItemId: line.ticketItemId,
    firedAt: line.ticketFiredAt,
    stationId: line.stationId,
    state: line.ticketState,
    firedQuantity: line.firedQuantity,
  };
}

/**
 * The reason's name in the operator's language, else in the venue's display language (what the
 * till screen shows an operator with no language of their own), else the reason's own name.
 */
export function reasonNameIn(
  reason: AdjustmentReason,
  operatorLocale: string | null,
  venueLocale: string,
): string {
  const language = (operatorLocale ?? venueLocale).split("-")[0]!.toLowerCase();
  const name = reason.names[language];
  return name === undefined ? reason.name : name;
}

/**
 * The part of the line covered, in thousandths, else `adjustment.quantity_invalid`: an extra is
 * covered only whole, because its quantity follows its dish.
 */
function coveredQuantity(orderId: string, line: Row, quantity: string | undefined): number {
  if (quantity === undefined) return line.quantity;
  const refused = () =>
    new AppError("adjustment.quantity_invalid", {
      workingOrderId: orderId,
      lineNo: line.lineNo,
      quantity,
    });
  const covered = quantityOfLine(quantity, line, refused);
  if (line.parentLineId !== null && covered < line.quantity) throw refused();
  return covered;
}

/** The discount a percentage or an amount asks for off `base`, checked against the action. */
function requestedDiscount(ask: AdjustmentAsk, base: Decimal): Decimal {
  if (ask.action === "discount_percent") {
    if (ask.amount !== undefined) throw invalid("amount");
    const bp = ask.percentBp;
    if (!isPercentBp(bp) || bp === 0) throw invalid("percentBp");
    return percentReduction(base, bp);
  }
  if (ask.percentBp !== undefined) throw invalid("percentBp");
  if (ask.action === "discount_amount") {
    const amount = ask.amount;
    if (
      amount === undefined ||
      compareDecimal(amount, ZERO) <= 0 ||
      compareDecimal(toScale(amount, MONEY_SCALE), amount) !== 0
    ) {
      throw invalid("amount");
    }
    return amount;
  }
  if (ask.amount !== undefined) throw invalid("amount");
  return base;
}

/** A row an adjustment prices, `quantity` of it, split off with the part of its dish covered when
 * `carved`; `exact` as {@link SpreadLine} takes it, and `exactWhenShort` as {@link spreadReaching}
 * takes it. */
interface Subject {
  row: Row;
  quantity: number;
  carved: boolean;
  exact: boolean;
  exactWhenShort: boolean;
}

/**
 * Whether a row standing for `lines` takes its share exactly: only when each line is one unmeasured
 * unit, so each takes one of the row's prices whole and no line is split. A dish's row then does;
 * an extra's row only when the exact rows alone miss the discount.
 */
function portionExactness(
  lines: readonly Pick<Subject, "row" | "quantity">[],
): Pick<Subject, "exact" | "exactWhenShort"> {
  const oneUnitEach = lines.every(
    ({ row, quantity }) => (row.unitPrecision ?? 0) === 0 && quantity === 1000,
  );
  const dish = lines[0]!.row.parentLineId === null;
  return { exact: oneUnitEach && dish, exactWhenShort: oneUnitEach && !dish };
}

type ShortSpreadLine = SpreadLine & { exactWhenShort: boolean };

/** {@link spreadBillDiscount} of `lines`; when it misses `discount`, spread again with the
 * `exactWhenShort` lines exact too. */
function spreadReaching(
  lines: readonly ShortSpreadLine[],
  discount: Decimal,
): Map<string, SpreadResult> {
  const first = spreadBillDiscount(lines, discount);
  const taken = sumDecimals([...first.values()].map(({ reduction }) => reduction));
  if (compareDecimal(taken, discount) === 0 || !lines.some((line) => line.exactWhenShort)) {
    return first;
  }
  return spreadBillDiscount(
    lines.map((line) => ({ ...line, exact: line.exact || line.exactWhenShort })),
    discount,
  );
}

/** Spread `discount` over `subjects` (plan D4, D15) and keep the rows whose price moves. */
function spread(subjects: readonly Subject[], discount: Decimal): Change[] {
  const lines: ShortSpreadLine[] = subjects.map(({ row, quantity, exact, exactWhenShort }) => ({
    lineId: row.id,
    addedOrder: row.lineNo,
    gross: gross(row, quantity),
    quantity: thousandthsToDecimal(quantity),
    priceQuantity: thousandthsToDecimal(row.priceQuantity),
    grossUnit: centsToDecimal(row.unit),
    exact,
    exactWhenShort,
  }));
  const results = spreadReaching(lines, discount);
  return subjects.flatMap(({ row, carved }) => {
    const result = results.get(row.id)!;
    if (compareDecimal(result.reduction, ZERO) === 0) return [];
    return [{ row, carved, rows: result.rows, reduction: result.reduction }];
  });
}

/**
 * A whole-bill discount over the rows the bill files (plan D29): bound portions grouped as
 * {@link readLockedLines} groups them for filing, each group spread as one line at its first member's
 * line number, then the group's rows handed to its portions in ordinal order, the higher price first.
 * A group of bound portions left at two prices pushes onto `splits` the split one grouped line would
 * record (plan D33): from its first portion to its first portion at the lower price. A bill holding
 * no bound portion is spread line by line.
 */
async function spreadOverFiledRows(
  tx: Transaction,
  orderId: string,
  subjects: readonly Subject[],
  discount: Decimal,
  splits: AdjustmentSplit[],
): Promise<Change[]> {
  const bindings = await readPortionBindings(
    tx,
    subjects.map(({ row }) => row.id),
  );
  if (bindings.size === 0) return spread(subjects, discount);
  const subjectOf = new Map(subjects.map((subject) => [subject.row.id, subject]));
  const groups = (await readLockedLines(tx, orderId)).map(({ identity }) =>
    (identity.lineIds ?? [identity.id]).map((id) => subjectOf.get(id)!),
  );
  const results = spreadReaching(
    groups.map((members) => {
      const { row, exact } = members[0]!;
      const quantity = members.reduce((sum, member) => sum + member.quantity, 0);
      const each = portionExactness(members);
      return {
        lineId: row.id,
        addedOrder: row.lineNo,
        gross: gross(row, quantity),
        quantity: thousandthsToDecimal(quantity),
        priceQuantity: thousandthsToDecimal(row.priceQuantity),
        grossUnit: centsToDecimal(row.unit),
        exact: exact || each.exact,
        exactWhenShort: each.exactWhenShort,
      };
    }),
    discount,
  );
  const ordinal = (subject: Subject) => bindings.get(subject.row.id)?.ordinal ?? 0;
  return groups.flatMap((members) => {
    const priced = results.get(members[0]!.row.id)!.rows;
    const handed = handOut(
      [...members].sort((a, b) => ordinal(a) - ordinal(b)),
      priced,
    );
    const lower = priced[1]?.unitGross;
    const second =
      lower === undefined
        ? undefined
        : handed.find(({ rows }) => compareDecimal(rows[0]!.unitGross, lower) === 0);
    if (second !== undefined) splits.push({ from: handed[0]!.row.id, to: second.row.id });
    return handed.filter(({ reduction }) => compareDecimal(reduction, ZERO) !== 0);
  });
}

/** One line's priced rows handed to the lines standing for it, in the order given, each taking
 * its own quantity from the rows that are left, the higher price first. */
function handOut(
  members: readonly Pick<Subject, "row" | "quantity" | "carved">[],
  priced: readonly PricedRow[],
): Change[] {
  const pieces = priced.map((piece) => ({ ...piece, left: decimalToThousandths(piece.quantity) }));
  return members.map(({ row, quantity, carved }) => {
    const rows: PricedRow[] = [];
    const cuts: Decimal[] = [];
    for (let need = quantity; need > 0;) {
      const piece = pieces.find((candidate) => candidate.left > 0)!;
      const take = Math.min(need, piece.left);
      piece.left -= take;
      need -= take;
      rows.push({ quantity: thousandthsToDecimal(take), unitGross: piece.unitGross });
      cuts.push(
        subtractDecimal(gross(row, take), gross(row, take, decimalToCents(piece.unitGross))),
      );
    }
    return { row, carved, rows, reduction: sumDecimals(cuts) };
  });
}

/**
 * The dish lines a part of a row takes (plan D32): the last `covered` portions by line number not
 * already cancelled, so the row's first portion, which the record names, stays while any of the row
 * does. Else `adjustment.quantity_invalid`, as more than one grouped line holds is.
 */
async function takenPortions(
  tx: Transaction,
  orderId: string,
  dish: Row,
  members: readonly Row[],
  covered: number,
): Promise<Set<string>> {
  const cancelled = await readLineCancellations(
    tx,
    members.map(({ id }) => id),
  );
  const active = members.filter(({ id }) => (cancelled.get(id) ?? 0) === 0);
  const count = covered / 1000;
  if (count > active.length) {
    throw new AppError("adjustment.quantity_invalid", {
      workingOrderId: orderId,
      lineNo: dish.lineNo,
      quantity: thousandthsToDecimal(covered),
    });
  }
  return new Set(active.slice(active.length - count).map(({ id }) => id));
}

/** The dish lines, in line order, of the till row a cancel's `lineIds` names, `lineId` among them;
 * refused as {@link standInRow} refuses a row the till could not have drawn. */
export async function cancelRowMembers(
  tx: Transaction,
  orderId: string,
  lineId: string,
  lineIds: readonly string[],
): Promise<string[]> {
  const row = await standInRow(
    tx,
    orderId,
    { lineId, lineIds: [...lineIds], action: "cancel" },
    await readRows(tx, orderId),
  );
  return row.membersOf.get(row.dish.id)!.map(({ id }) => id);
}

/**
 * The dish lines `lineIds` names, gathered into the rows the till would draw them as, each row in
 * line order and the rows in the order of their first line in `lineIds`: whole portions in one filed
 * group, its cohort included, in the same release group with the same note and course; any other
 * line alone. For a Discard, which names no rows (plan D31's one exception).
 */
export async function rowsAmong(
  tx: Transaction,
  orderId: string,
  lineIds: readonly string[],
): Promise<string[][]> {
  const rows = await readRows(tx, orderId);
  const whole = await readWholePortionLines(tx, lineIds);
  const groups = await readLockedLines(tx, orderId);
  const keyOf = (id: string) => {
    if (!whole.has(id)) return id;
    const row = rows.find((one) => one.id === id)!;
    const group = groups.findIndex(({ identity }) => (identity.lineIds ?? []).includes(id));
    return canonical([group, row.groupId, row.note, row.courseId]);
  };
  const byKey = new Map<string, Row[]>();
  for (const id of lineIds) {
    const key = keyOf(id);
    byKey.set(key, [...(byKey.get(key) ?? []), rows.find((one) => one.id === id)!]);
  }
  return [...byKey.values()].map((row) =>
    row.sort((a, b) => a.lineNo - b.lineNo).map(({ id }) => id),
  );
}

/** A comp's rows (plan D4): each one not already free is priced at exactly zero, never at a price
 * whose total merely rounds to nothing. */
function zeroed(subjects: readonly Subject[]): Change[] {
  return subjects
    .filter(({ row }) => row.unit !== 0)
    .map(({ row, quantity, carved }) => ({
      row,
      carved,
      rows: [{ quantity: thousandthsToDecimal(quantity), unitGross: ZERO }],
      reduction: gross(row, quantity),
    }));
}

/**
 * Everything an adjustment decides before it writes, reading only: the refusals of the bill, the
 * line, the amount and the reason's policy, and the rows it would change. A dish is
 * taken with its extras; part of one splits its extras in proportion, the part covered taking the
 * part of each. An extra is taken on its own, and only whole.
 */
export async function planAdjustment(
  tx: Transaction,
  ask: AdjustmentAsk,
  venueLocale: string,
): Promise<Plan> {
  const { orderId } = ask;
  // An open bill, a table's or a counter order.
  const revision = await assertTabOpen(tx, orderId);
  if (revision !== ask.expectedRevision) {
    throw new AppError("working_order.out_of_date", { workingOrderId: orderId, revision });
  }
  await refusePaymentInFlight(tx, [orderId]);
  await requireOrderBillEditor(tx, orderId, ask);
  const reason = await findAdjustmentReason(tx, ask.reasonId);
  const read = await readRows(tx, orderId);
  const { rows, released } = await atReleasedPrices(tx, ask, read);

  let line: Row | null = null;
  let covered: number | null = null;
  let removed: number | null = null;
  let removedPortions: Row[] | null = null;
  let carve: Carve | null = null;
  let changes: Change[] = [];
  let writes: Change[] | null = null;
  let stamped: string[] = [];
  const rowSplits: AdjustmentSplit[] = [];
  let row: StandIn | null = null;
  let view: readonly Row[] = rows;
  let reduction: Decimal;
  let nominal: Decimal;
  let before: Decimal;
  if (ask.lineId === null) {
    if (ask.action === "cancel" || ask.action === "comp") throw invalid("lineId");
    if (ask.quantity !== undefined) throw invalid("quantity");
    const families = new Set(rows.flatMap((row) => row.parentLineId ?? []));
    before = sumDecimals(rows.map((row) => gross(row, row.quantity)));
    changes = await spreadOverFiledRows(
      tx,
      orderId,
      rows.map((row) => {
        const each = portionExactness([{ row, quantity: row.quantity }]);
        return {
          row,
          quantity: row.quantity,
          carved: false,
          exact:
            (row.parentLineId === null &&
              !families.has(row.id) &&
              (row.unitPrecision ?? 0) === 0) ||
            each.exact,
          exactWhenShort: each.exactWhenShort,
        };
      }),
      requestedDiscount(ask, before),
      rowSplits,
    );
    reduction = sumDecimals(changes.map((change) => change.reduction));
    nominal = sumDecimals(rows.map((row) => listValue(row, row.quantity)));
  } else {
    line = rows.find((row) => row.id === ask.lineId) ?? null;
    if (line === null)
      throw new AppError("tab.line_not_found", { tabId: orderId, lineId: ask.lineId });
    if (ask.action === "cancel" && line.setMenuRole === "set_menu")
      throw new AppError("set_menu.worked_out_by_bill", {});
    if (ask.lineIds !== undefined) {
      row = await standInRow(tx, orderId, ask, rows);
      ({ line, view } = row);
    }
    const target = line;
    // An extra has no extras of its own, so it is a family of one.
    const family = [target, ...view.filter((other) => other.parentLineId === target.id)];
    covered = coveredQuantity(orderId, target, ask.quantity);
    const partial = covered < target.quantity;
    const weighed = (target.unitPrecision ?? 0) > 0;
    if (ask.action === "cancel") {
      if (ask.percentBp !== undefined) throw invalid("percentBp");
      if (ask.amount !== undefined) throw invalid("amount");
      if (row === null) {
        const cancelled = await readLineCancellations(tx, [target.id]);
        if (covered > serviceQuantities(target.quantity, 0, cancelled.get(target.id) ?? 0).active)
          throw new AppError("adjustment.quantity_invalid", {
            workingOrderId: orderId,
            lineNo: target.lineNo,
            quantity: ask.quantity ?? thousandthsToDecimal(covered),
          });
        removed = partial ? covered : null;
      } else {
        const members = row.membersOf.get(target.id)!;
        const taken = await takenPortions(tx, orderId, target, members, covered);
        removedPortions = members.filter((one) => taken.has(one.id));
      }
      const left = familyAt(family, target.quantity - covered);
      reduction = sumDecimals(
        family.map((row) =>
          subtractDecimal(gross(row, row.quantity), gross(row, left.get(row.id)!)),
        ),
      );
      nominal = sumDecimals(family.map((row) => listValue(row, row.quantity - left.get(row.id)!)));
      before = reduction;
    } else {
      // Part of a weighed line, carved off, can round to totals whose sum is not the line's: 0.005 kg
      // at €1.00/kg is €0.01, while 0.002 kg and 0.003 kg are €0.00 each.
      // Refused even when exactly representable: the owner's decision of 2026-09-30,
      // docs/backlog/till.md, Decisions and deliberate limits, "Part of a weighed line stays refused".
      if (partial && weighed) {
        throw new AppError("adjustment.weighed_partial", {
          workingOrderId: orderId,
          lineNo: target.lineNo,
        });
      }
      const standingFor = (one: Row) => (row === null ? [one] : row.membersOf.get(one.id)!);
      const exactness = (standIn: Row, quantity: number) =>
        portionExactness(
          row === null
            ? [{ row: standIn, quantity }]
            : standingFor(standIn).map((member) => ({ row: member, quantity: member.quantity })),
        );
      let subjects: Subject[];
      if (partial) {
        carve = { lineNo: target.lineNo, quantity: covered };
        const carved = familyAt(family, covered);
        const kept = familyAt(family, target.quantity - covered);
        // An extra that is not a whole count a dish would split into parts that do not add up to it,
        // whatever part is asked: no part of such a dish can be taken, only the whole.
        if (family.some((row) => carved.get(row.id)! + kept.get(row.id)! !== row.quantity)) {
          throw new AppError("adjustment.quantity_invalid", {
            workingOrderId: orderId,
            lineNo: target.lineNo,
            quantity: ask.quantity!,
          });
        }
        subjects = family.map((row) => {
          const each = exactness(row, carved.get(row.id)!);
          return {
            row,
            quantity: carved.get(row.id)!,
            carved: true,
            exact: family.length === 1 || each.exact,
            exactWhenShort: each.exactWhenShort,
          };
        });
      } else {
        subjects = family.map((row) => {
          const each = exactness(row, row.quantity);
          return {
            row,
            quantity: row.quantity,
            carved: false,
            exact: (family.length === 1 && target.parentLineId === null && !weighed) || each.exact,
            exactWhenShort: each.exactWhenShort,
          };
        });
      }
      before = sumDecimals(subjects.map(({ row, quantity }) => gross(row, quantity)));
      const discount = requestedDiscount(ask, before);
      changes = ask.action === "comp" ? zeroed(subjects) : spread(subjects, discount);
      if (row !== null) {
        const { membersOf } = row;
        const taken = partial
          ? await takenPortions(tx, orderId, target, membersOf.get(target.id)!, covered)
          : null;
        const takenOf = (standIn: Row) =>
          membersOf
            .get(standIn.id)!
            .filter((member) => taken === null || taken.has(member.parentLineId ?? member.id));
        // The part is carved off the line and each of its extras, as on one grouped line (plan D33).
        if (taken !== null) {
          for (const standIn of family) {
            rowSplits.push({ from: standingFor(standIn)[0]!.id, to: takenOf(standIn)[0]!.id });
          }
        }
        stamped = changes.flatMap((change) => standingFor(change.row).map((one) => one.id));
        writes = changes.flatMap((change) => {
          const portions = handOut(
            takenOf(change.row).map((member) => ({
              row: member,
              quantity: member.quantity,
              carved: false,
            })),
            change.rows,
          );
          // The line's second price is split off it, as on one grouped line (plan D33).
          const lower = change.rows[1];
          if (lower !== undefined) {
            rowSplits.push({
              from: portions[0]!.row.id,
              to: portions.find(
                (portion) => compareDecimal(portion.rows[0]!.unitGross, lower.unitGross) === 0,
              )!.row.id,
            });
          }
          return portions;
        });
      }
      reduction = sumDecimals(changes.map((change) => change.reduction));
      nominal = sumDecimals(subjects.map(({ row, quantity }) => listValue(row, quantity)));
    }
  }

  if (ask.action !== "cancel" && compareDecimal(reduction, ZERO) === 0) {
    throw new AppError("adjustment.no_reduction", { workingOrderId: orderId });
  }
  const [actor] = await tx
    .select({ locale: persons.locale })
    .from(persons)
    .where(eq(persons.id, ask.operatorId));
  if (actor === undefined) throw new AppError("person.not_found", { personId: ask.operatorId });
  const actorPermissions = (await readPersonAuthority(tx, ask.operatorId)).permissions;
  const stage = line === null ? null : stageOf(dishOf(line, view));
  const maxBillComp =
    ask.action === "cancel" ? null : (await readAdjustmentSettings(tx)).maxBillComp;
  const verdict =
    ask.action === "cancel"
      ? evaluateCancel(reason, { actorPermissions, note: ask.note, stage: stage! })
      : await judgeComp(tx, reason, {
          orderId,
          action: ask.action,
          rows,
          writes: writes ?? changes,
          carve,
          reduction,
          before,
          actorPermissions,
          maxBillComp,
          note: ask.note,
        });
  if (verdict.kind === "refused") throw new AppError(verdict.code, {});
  return {
    reason,
    reasonName: reasonNameIn(reason, actor.locale, venueLocale),
    maxBillComp,
    rows: read,
    line,
    covered,
    removed,
    removedPortions,
    carve,
    changes,
    writes: writes ?? changes,
    stamped,
    released: (writes ?? changes).flatMap(({ row }) => (released.has(row.id) ? [row.id] : [])),
    rowSplits,
    reduction,
    nominal,
    before,
    stage,
    approval: verdict.kind === "needs_approval" ? verdict.approval : null,
  };
}

/** The line's dish: the line itself, or the dish an extra belongs to, whose stage it shares. */
function dishOf(line: Row, rows: readonly Row[]): Row {
  return line.parentLineId === null ? line : rows.find((row) => row.id === line.parentLineId)!;
}

async function judgeComp(
  tx: Transaction,
  reason: AdjustmentReason,
  ask: {
    orderId: string;
    action: CompAction;
    /** Every line of the bill, as {@link readRows} reads it. */
    rows: readonly Row[];
    /** What this request writes, on the bill's own lines. */
    writes: readonly Change[];
    carve: Carve | null;
    reduction: Decimal;
    /** What the request's subject cost before it. */
    before: Decimal;
    actorPermissions: ReadonlySet<string>;
    maxBillComp: Decimal | null;
    note: string | null;
  },
): Promise<AdjustmentVerdict> {
  const { orderId, rows } = ask;
  const standingOnBill = standingOff(
    await readReasonStanding(tx, { workingOrderId: orderId, reasonId: reason.id }),
  );
  const billComped = sumDecimals(
    rows.map((row) => {
      const off = subtractDecimal(listValue(row, row.quantity), gross(row, row.quantity));
      return compareDecimal(off, ZERO) > 0 ? off : ZERO;
    }),
  );
  return evaluateComp(reason, {
    action: ask.action,
    reduction: ask.reduction,
    actorPermissions: ask.actorPermissions,
    note: ask.note,
    takesAll: compareDecimal(ask.reduction, ask.before) === 0,
    standingOnBill,
    dishes: dishPrices(ask.writes, rows, ask.carve),
    billComped,
    billLimit: { maxAmount: ask.maxBillComp },
  });
}

/**
 * Each dish `writes` names, as the floor reads it (plan D36 readings 3 to 5): a dish without extras
 * once for each price its change leaves it at; a dish with extras once, its lines summed at the
 * quantity of it the request covers. A portion of a row the request takes nothing off is named too;
 * {@link standInRow} admits only portions of one price, so it is below its floor only when one the
 * request reduces is too.
 */
function dishPrices(
  writes: readonly Change[],
  rows: readonly Row[],
  carve: Carve | null,
): DishPrice[] {
  const byDish = new Map<string, Change[]>();
  for (const change of writes) {
    const dishId = change.row.parentLineId ?? change.row.id;
    byDish.set(dishId, [...(byDish.get(dishId) ?? []), change]);
  }
  const quantityOf = (change: Change) =>
    change.rows.reduce((sum, priced) => sum + decimalToThousandths(priced.quantity), 0);
  const allowanceOf = (lines: { row: Row; quantity: number }[]) =>
    floorAllowance(
      lines.map(({ row, quantity }) => ({
        quantity: thousandthsToDecimal(quantity),
        priceQuantity: thousandthsToDecimal(row.priceQuantity),
      })),
    );
  const dishes: DishPrice[] = [];
  for (const [dishId, changed] of byDish) {
    const dish = rows.find((row) => row.id === dishId)!;
    const family = [dish, ...rows.filter((row) => row.parentLineId === dishId)];
    const onDish = changed.find((change) => change.row.id === dishId);
    if (family.length === 1) {
      for (const priced of onDish!.rows) {
        const quantity = decimalToThousandths(priced.quantity);
        dishes.push({
          list: listValue(dish, quantity),
          after: gross(dish, quantity, decimalToCents(priced.unitGross)),
          allowance: allowanceOf([{ row: dish, quantity }]),
        });
      }
      continue;
    }
    // A dish at €0.00 keeps no change of its own here, though part of it was carved with its extras.
    const covered =
      onDish !== undefined
        ? quantityOf(onDish)
        : changed.some((change) => change.carved)
          ? carve!.quantity
          : dish.quantity;
    const at = familyAt(family, covered);
    const lines = family.map((row) => {
      const change = changed.find((one) => one.row.id === row.id);
      const quantity = change === undefined ? at.get(row.id)! : quantityOf(change);
      const after =
        change === undefined
          ? gross(row, quantity)
          : sumDecimals(
              change.rows.map((priced) =>
                gross(row, decimalToThousandths(priced.quantity), decimalToCents(priced.unitGross)),
              ),
            );
      return { row, quantity, list: listValue(row, quantity), after };
    });
    dishes.push({
      list: sumDecimals(lines.map(({ list }) => list)),
      after: sumDecimals(lines.map(({ after }) => after)),
      allowance: allowanceOf(lines),
    });
  }
  return dishes;
}

/** What the adjustment would do, writing nothing: the same plan {@link applyAdjustment} writes, and
 * its refusal of a bill raised past the simplified-invoice limit. */
export async function previewAdjustment(
  tx: Transaction,
  cfg: Pick<TradingContext, "simplifiedInvoiceLimit">,
  ask: AdjustmentAsk,
  venueLocale: string,
): Promise<AdjustmentPreview> {
  const plan = await planAdjustment(tx, ask, venueLocale);
  const regrouped =
    ask.action === "cancel"
      ? await regroupDropOfRemoval(
          tx,
          ask.orderId,
          (plan.removedPortions ?? [plan.line!]).map(voidTargetOf),
          plan.removed,
        )
      : 0;
  const lines =
    ask.action === "cancel"
      ? [
          {
            lineId: plan.line!.id,
            lineNo: plan.line!.lineNo,
            reduction: money(plan.reduction),
            rows: [],
          },
        ]
      : plan.changes.map((change) => ({
          lineId: change.row.id,
          lineNo: change.row.lineNo,
          reduction: money(change.reduction),
          rows: change.rows.map((row) => ({
            quantity: row.quantity,
            unitGross: money(row.unitGross),
          })),
        }));
  const reduction = addDecimal(plan.reduction, centsToDecimal(regrouped));
  const billTotal = await billTotalOf(
    tx,
    ask.orderId,
    plan,
    ask.action === "cancel" ? reduction : null,
  );
  if (ask.action !== "cancel") {
    await refuseOrderOverSimplifiedLimit(tx, cfg, ask.orderId, billTotal.before, billTotal.after);
  }
  return {
    reduction: money(reduction),
    nominalValue: money(plan.nominal),
    billTotal: { before: money(billTotal.before), after: money(billTotal.after) },
    needsApproval: plan.approval === null ? null : wireApproval(plan.approval),
    lines,
  };
}

/** The approver, verified by PIN, when the plan needs one (plan D6). */
async function approvedBy(
  tx: Transaction,
  approval: Approval | null,
  approver: AdjustmentArgs["approver"],
): Promise<string | null> {
  if (approval === null) return null;
  const refused = () => new AppError("adjustment.approval_required", { approval: approval.by });
  if (approver === undefined) throw refused();
  const { personId, pin, checked, attempts } = approver;
  const { authority } = await verifyThrottledCredential(tx, personId, pin, attempts, checked);
  if (!approves(approval, authority.permissions)) throw refused();
  return approver.personId;
}

async function setPrice(
  tx: Transaction,
  lineId: string,
  row: PricedRow,
  priceQuantity: number,
): Promise<void> {
  await tx
    .update(workingOrderLines)
    .set({
      unitPriceGross: decimalToCents(row.unitGross),
      lineTotal: decimalToCents(
        divideDecimal(
          multiplyDecimal(row.unitGross, row.quantity),
          thousandthsToDecimal(priceQuantity),
          MONEY_SCALE,
        ),
      ),
    })
    .where(eq(workingOrderLines.id, lineId));
}

/**
 * Writes the plan's new prices, first splitting the part `carve` covers off its dish, with its
 * extras, when a change is to that part; answers each row it split off, with the row it came from,
 * a carved dish before its extras, and what each change took off each line it lowered.
 */
async function reprice(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  carve: Carve | null,
  changes: readonly Change[],
  stamped: readonly string[],
): Promise<{ splits: AdjustmentSplit[]; taken: LineReduction[] }> {
  const touched = [...new Set([...changes.map(({ row }) => row.id), ...stamped])];
  // Before any split, so a split row copies the price its line had (plan D21).
  await tx
    .update(workingOrderLines)
    .set({
      listUnitPriceGross: sql`coalesce(${workingOrderLines.listUnitPriceGross}, ${workingOrderLines.unitPriceGross})`,
    })
    .where(inArray(workingOrderLines.id, touched));
  const carved = changes.some((change) => change.carved)
    ? await splitLinesWithinOrder(
        tx,
        cfg,
        orderId,
        [{ lineNo: carve!.lineNo, quantity: thousandthsToDecimal(carve!.quantity) }],
        { splitExtras: true },
      )
    : new Map<string, SplitRow>();
  const splits: AdjustmentSplit[] = [...carved].map(([from, to]) => ({ from, to: to.id }));
  const subjects = changes.map((change) => {
    const { id, lineNo } = change.carved ? carved.get(change.row.id)! : change.row;
    return { id, lineNo, change };
  });
  const twoRows = subjects.filter(({ change }) => change.rows.length === 2);
  const seconds =
    twoRows.length === 0
      ? new Map<string, SplitRow>()
      : await splitLinesWithinOrder(
          tx,
          cfg,
          orderId,
          twoRows.map(({ lineNo, change }) => ({ lineNo, quantity: change.rows[1]!.quantity })),
        );
  const taken: LineReduction[] = [];
  for (const { id, change } of subjects) {
    const [first, lower] = change.rows;
    await setPrice(tx, id, first!, change.row.priceQuantity);
    const second = seconds.get(id);
    let firstReduction = change.reduction;
    if (second !== undefined) {
      splits.push({ from: id, to: second.id });
      await setPrice(tx, second.id, lower!, change.row.priceQuantity);
      const quantity = decimalToThousandths(lower!.quantity);
      const reduction = subtractDecimal(
        gross(change.row, quantity),
        gross(change.row, quantity, decimalToCents(lower!.unitGross)),
      );
      firstReduction = subtractDecimal(change.reduction, reduction);
      taken.push({ lineId: second.id, reduction, quantity });
    }
    taken.push({
      lineId: id,
      reduction: firstReduction,
      quantity: decimalToThousandths(first!.quantity),
    });
  }
  return {
    splits,
    taken: taken.filter(({ reduction }) => compareDecimal(reduction, ZERO) !== 0),
  };
}

/** What a comp or a discount took off one line, `quantity` of it then (plan D37). */
interface LineReduction {
  lineId: string;
  reduction: Decimal;
  quantity: number;
}

/**
 * Apply a cancellation, comp or discount to an open bill, a table's or a counter order, at most once
 * per submission id on the bill (plan D8): a cancel removes the part ({@link removeFromLine}),
 * telling the kitchen about a dish it had, or about the dish a cancelled extra came off; a comp or a
 * discount lowers the prices by plan D4 and D15, and tells the kitchen nothing. It moves the bill's revision on, and its party's when it has one, and records one
 * adjustment. The PIN never enters the recorded command. `venueLocale` is the venue's display
 * language, which names the reason for an operator with no language of their own.
 */
export async function applyAdjustment(
  tx: Transaction,
  cfg: TradingContext,
  args: AdjustmentArgs & { admission: TradingAdmission },
  venueLocale: string,
  attendance?: OrderAttendance,
  complete?: () => Promise<TillSaleResult | null>,
): Promise<{ adjustmentIds: string[]; revision: number; invoice?: TillSaleResult }> {
  const { submissionId, approver, admission, ...command } = args;
  await requireEconomicWrite(tx, cfg, admission);
  const expectedEdit =
    args.expectedEdit == null ? args.expectedEdit : parseBillEditExpected(args.expectedEdit);
  return runServiceCommand(
    tx,
    { kind: "bill", workingOrderId: args.orderId },
    submissionId,
    "adjustment.apply",
    { ...command, expectedEdit, approverId: approver?.personId },
    async () => {
      const plan = await planAdjustment(tx, args, venueLocale);
      const approved = await approvedBy(tx, plan.approval, approver);
      const activity =
        attendance === undefined
          ? undefined
          : { recorder: attendance.recorder, at: attendance.clock.now().instant.toISOString() };
      let splits: AdjustmentSplit[] = [];
      let taken: LineReduction[] = [];
      // A cancel records the bill's whole drop, its set menus worked out again included (D24).
      let regrouped = 0;
      if (plan.removedPortions !== null) {
        regrouped = await removePortions(
          tx,
          cfg,
          args.orderId,
          plan.removedPortions.map(voidTargetOf),
          args.operatorId,
          activity,
          args.preparationStarted,
        );
      } else if (args.action === "cancel") {
        regrouped = await removeFromLine(
          tx,
          cfg,
          args.orderId,
          voidTargetOf(plan.line!),
          plan.removed,
          args.operatorId,
          activity,
          args.preparationStarted,
        );
      } else {
        const before = await totalBeforeEdit(tx, cfg, args.orderId);
        await releaseDishes(tx, plan.released);
        const repriced = await reprice(
          tx,
          cfg,
          args.orderId,
          plan.carve,
          plan.writes,
          plan.stamped,
        );
        splits = [...repriced.splits, ...plan.rowSplits];
        taken = repriced.taken;
        await bumpRevision(tx, [args.orderId]);
        await regroupAdjusted(tx, cfg, args.orderId, before);
        await partyAfterEdit(tx, args.orderId, [], args.operatorId, activity);
      }
      const { line } = plan;
      const id = await recordAdjustment(tx, {
        workingOrderId: args.orderId,
        line:
          line === null
            ? null
            : {
                id: line.id,
                name: staffPresentationName(line),
                quantity: thousandthsToDecimal(line.quantity),
                listUnitPriceGross: centsToDecimal(line.list ?? line.unit),
                creditedTo: line.creditedTo,
                stage: plan.stage!,
              },
        splits,
        quantity: plan.covered === null ? null : thousandthsToDecimal(plan.covered),
        reason: {
          id: plan.reason.id,
          name: plan.reasonName,
          policy: policySnapshotOf(plan.reason, { maxBillComp: plan.maxBillComp }),
        },
        action: args.action,
        percentBp: args.action === "discount_percent" ? args.percentBp! : null,
        beforeAmount: addDecimal(plan.before, centsToDecimal(regrouped)),
        afterAmount: subtractDecimal(plan.before, plan.reduction),
        reduction: addDecimal(plan.reduction, centsToDecimal(regrouped)),
        nominalValue: plan.nominal,
        requestedBy: args.operatorId,
        approvedBy: approved,
        note: args.note,
        preparationStarted: args.recordedPreparationStarted ?? null,
      });
      if (taken.length > 0) {
        await insertInChunks(
          tx,
          adjustmentLines,
          taken.map(({ lineId, reduction, quantity }) => ({
            adjustmentId: id,
            lineId,
            reduction: decimalToCents(reduction),
            quantity,
          })),
        );
      }
      const revision = await readOrderRevision(tx, args.orderId);
      if (attendance !== undefined) {
        await captureOrderEdit(
          tx,
          attendance,
          args.orderId,
          args.operatorId,
          revision,
          "adjustment",
          activity?.at,
        );
      }
      const invoice = await complete?.();
      return { adjustmentIds: [id], revision, ...(invoice == null ? {} : { invoice }) };
    },
    cfg.madeHereSink,
  );
}
