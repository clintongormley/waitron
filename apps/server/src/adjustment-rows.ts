import { eq } from "drizzle-orm";
import type { AdjustmentStage, Approval } from "@waitron/adjustments";
import { orderGroups, ticketItems, workingOrderLines } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToThousandths,
  divideDecimal,
  MONEY_SCALE,
  multiplyDecimal,
  QUANTITY_SCALE,
  thousandthsToDecimal,
  type Decimal,
} from "@waitron/shared";
import type { AdjustmentAsk } from "./adjustments-apply.js";
import { invalid, money } from "./bill-allocation.js";
import { firedQuantity, type TicketState } from "./kitchen-ticket-state.js";
import { extraQuantityFor, keptExtrasOf } from "./order-line-quantities.js";
import { readWholePortionLines } from "./order-portions.js";
import { readLockedLines, type StoredOrderLine } from "./stored-order-lines.js";
import { isReleased } from "./working-order-serving.js";

/** A row of the bill as an adjustment reads it: quantities in thousandths, money in cents. */
export interface Row {
  id: string;
  setMenuRole: (typeof workingOrderLines.$inferSelect)["setMenuRole"];
  setMenuLineId: string | null;
  lineNo: number;
  parentLineId: string | null;
  productId: string | null;
  extraListId: string | null;
  name: string;
  variantName: string | null;
  note: string | null;
  courseId: string | null;
  quantity: number;
  priceQuantity: number;
  unit: number;
  list: number | null;
  aLaCarte: number | null;
  unitPrecision: number | null;
  groupId: string | null;
  groupState: "held" | "fired" | "removed" | null;
  creditedTo: string | null;
  servedQuantity: number;
  sentAt: string | null;
  ticketItemId: string | null;
  ticketFiredAt: string | null;
  ticketMadeHere: boolean | null;
  stationId: string | null;
  ticketState: TicketState | null;
  firedQuantity: number;
}

export function gross(row: Row, quantity: number, unitCents = row.unit): Decimal {
  return divideDecimal(
    multiplyDecimal(centsToDecimal(unitCents), thousandthsToDecimal(quantity)),
    thousandthsToDecimal(row.priceQuantity),
    MONEY_SCALE,
  );
}

/** A row's value before any adjustment (plan D21), for `quantity` of it. */
export function listValue(row: Row, quantity: number): Decimal {
  return gross(row, quantity, row.list ?? row.unit);
}

export async function readRows(tx: Transaction, orderId: string): Promise<Row[]> {
  return tx
    .select({
      id: workingOrderLines.id,
      setMenuRole: workingOrderLines.setMenuRole,
      setMenuLineId: workingOrderLines.setMenuLineId,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      productId: workingOrderLines.productId,
      extraListId: workingOrderLines.extraListId,
      name: workingOrderLines.name,
      variantName: workingOrderLines.variantName,
      note: workingOrderLines.note,
      courseId: workingOrderLines.courseId,
      quantity: workingOrderLines.quantity,
      priceQuantity: workingOrderLines.priceQuantity,
      unit: workingOrderLines.unitPriceGross,
      list: workingOrderLines.listUnitPriceGross,
      aLaCarte: workingOrderLines.aLaCarteUnitPrice,
      unitPrecision: workingOrderLines.unitPrecision,
      groupId: workingOrderLines.groupId,
      groupState: orderGroups.state,
      creditedTo: workingOrderLines.creditedTo,
      servedQuantity: workingOrderLines.servedQuantity,
      sentAt: workingOrderLines.sentAt,
      ticketItemId: ticketItems.id,
      ticketFiredAt: ticketItems.firedAt,
      ticketMadeHere: ticketItems.madeHere,
      stationId: ticketItems.stationId,
      ticketState: ticketItems.state,
      firedQuantity,
    })
    .from(workingOrderLines)
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(eq(workingOrderLines.workingOrderId, orderId))
    .orderBy(workingOrderLines.lineNo);
}

/** How far the dish had got (ruling R8). */
export function stageOf(dish: Row): AdjustmentStage {
  if (dish.servedQuantity > 0) return "served";
  if (isReleased(dish)) return "fired";
  return dish.groupState === "held" ? "held" : "unsent";
}

/** A row of identical portions as one stand-in line (plan D32), and what it stands for. */
export interface StandIn {
  /** The stand-in dish: the first portion's id, prices and line number, the members' quantity. */
  dish: Row;
  /** What the request acts on: the stand-in dish, or one of its stand-in extras (plan D34). */
  line: Row;
  /** The bill's rows with the members and their extras replaced by the stand-in lines. */
  view: Row[];
  /** Every member's dish and extras lines. */
  lines: Row[];
  /** Each stand-in line's id, and the lines it stands for, in line order. */
  membersOf: Map<string, Row[]>;
}

const STAGE_RANK: Record<AdjustmentStage, number> = { unsent: 0, held: 1, fired: 2, served: 3 };

/** Object keys sorted, so stored descriptions in a different key order compare equal. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** What a filed group shows, its quantity, cohort and position left out; a list price equal to the
 * price reads as none, as filing drops it. */
function groupFields({ identity, locked }: StoredOrderLine): unknown {
  const { id, lineIds, dishLineIds, listUnitGross, ...kept } = identity;
  void id;
  void lineIds;
  void dishLineIds;
  return {
    ...kept,
    listUnitGross:
      listUnitGross !== null && compareDecimal(listUnitGross, decimal(locked.grossUnitPrice)) !== 0
        ? listUnitGross
        : null,
    locked: { ...locked, quantity: null, parentLineNo: null },
  };
}

/** The filed group holding dish line `lineId`, compared without its cohort: its fields and each of
 * its extras' fields and quantity per dish. */
function cohortFreeKey(groups: readonly StoredOrderLine[], lineId: string): string {
  const at = groups.findIndex(
    (group) => group.locked.parentLineNo == null && (group.identity.lineIds ?? []).includes(lineId),
  );
  const dish = groups[at]!;
  const extras = groups
    .filter((group) => group.locked.parentLineNo === at + 1)
    .map((extra) =>
      canonical([
        groupFields(extra),
        divideDecimal(
          decimal(extra.locked.quantity),
          decimal(dish.locked.quantity),
          QUANTITY_SCALE,
        ),
      ]),
    )
    .sort();
  return canonical([groupFields(dish), extras]);
}

/**
 * The till row `ask.lineIds` names as one stand-in line, else `management.request_invalid` on
 * `lineIds`: each member a dish line of this bill bound to a whole, unmeasured portion, every one
 * of them in one filed group but for the cohort, with one note and one course (plan D31) — or one
 * extra of each such dish, the same extra on every one (D34). The stand-in's extras are the
 * members' extras, one per extra, each at the first member's extra's line number; its served
 * quantity is the members' sum and its kitchen facts the furthest member's (D32).
 */
export async function standInRow(
  tx: Transaction,
  orderId: string,
  ask: Pick<AdjustmentAsk, "lineId" | "lineIds" | "action">,
  rows: readonly Row[],
): Promise<StandIn> {
  const ids = ask.lineIds!;
  // Every refusal here is a fault in Waitron: the till names only the rows it grouped.
  if (ids.length < 2 || new Set(ids).size !== ids.length || !ids.includes(ask.lineId!)) {
    throw invalid("lineIds");
  }
  const named = ids.map((id) => rows.find((row) => row.id === id));
  if (named.some((one) => one === undefined)) throw invalid("lineIds");
  const extrasRow = named[0]!.parentLineId !== null;
  // An extra is cancelled on its own only from its own line.
  if (extrasRow && ask.action === "cancel") throw invalid("lineIds");
  if (named.some((one) => (one!.parentLineId !== null) !== extrasRow)) throw invalid("lineIds");
  const dishIds = extrasRow ? named.map((one) => one!.parentLineId!) : ids;
  if (new Set(dishIds).size !== dishIds.length) throw invalid("lineIds");
  const members = dishIds.map((id) => rows.find((row) => row.id === id)!);
  const whole = await readWholePortionLines(tx, dishIds);
  if (dishIds.some((id) => !whole.has(id))) throw invalid("lineIds");
  const groups = await readLockedLines(tx, orderId);
  if (new Set(dishIds.map((id) => cohortFreeKey(groups, id))).size !== 1) {
    throw invalid("lineIds");
  }
  // Filing groups dishes whatever their note or course; the till's row does not.
  if (new Set(members.map((member) => canonical([member.note, member.courseId]))).size !== 1) {
    throw invalid("lineIds");
  }

  const dishes = members.sort((a, b) => a.lineNo - b.lineNo);
  // One product can come from two lists at one price.
  const extraOrder = (row: Row) =>
    canonical([
      row.productId,
      row.extraListId,
      row.name,
      row.variantName,
      row.unit,
      row.list,
      row.priceQuantity,
      row.quantity,
    ]);
  const families = dishes.map((dish) => ({
    dish,
    extras: rows
      .filter((row) => row.parentLineId === dish.id)
      .sort((a, b) => (extraOrder(a) < extraOrder(b) ? -1 : extraOrder(a) > extraOrder(b) ? 1 : 0)),
  }));
  const sum = (lines: readonly Row[], of: (row: Row) => number) =>
    lines.reduce((total, row) => total + of(row), 0);
  const furthest = dishes.reduce((far, dish) =>
    STAGE_RANK[stageOf(dish)] > STAGE_RANK[stageOf(far)] ? dish : far,
  );
  const first = families[0]!;
  const dish: Row = {
    ...first.dish,
    quantity: sum(dishes, (row) => row.quantity),
    servedQuantity: sum(dishes, (row) => row.servedQuantity),
    firedQuantity: sum(dishes, (row) => row.firedQuantity),
    groupId: furthest.groupId,
    groupState: furthest.groupState,
    sentAt: furthest.sentAt,
    ticketItemId: furthest.ticketItemId,
    ticketFiredAt: furthest.ticketFiredAt,
    ticketMadeHere: furthest.ticketMadeHere,
    stationId: furthest.stationId,
    ticketState: furthest.ticketState,
  };
  const membersOf = new Map<string, Row[]>([[dish.id, dishes]]);
  const extras = first.extras.map((extra, i) => {
    const standing = families.map((family) => family.extras[i]!);
    membersOf.set(extra.id, standing);
    return { ...extra, quantity: sum(standing, (row) => row.quantity) };
  });
  const lines = families.flatMap((family) => [family.dish, ...family.extras]);
  const replaced = new Set(lines.map((row) => row.id));
  let line = dish;
  if (extrasRow) {
    const asked = new Set(ids);
    const extra = extras.find(({ id }) => {
      const standing = membersOf.get(id)!;
      return standing.length === asked.size && standing.every((one) => asked.has(one.id));
    });
    if (extra === undefined) throw invalid("lineIds");
    line = extra;
  }
  return {
    dish,
    line,
    view: [...rows.filter((row) => !replaced.has(row.id)), dish, ...extras].sort(
      (a, b) => a.lineNo - b.lineNo,
    ),
    lines,
    membersOf,
  };
}

/**
 * The quantity, in thousandths, each row of a dish's family (the dish first, then its extras) holds
 * when the dish holds `dishQuantity`: an extra follows its dish, as {@link removeFromLine} and
 * {@link splitLinesWithinOrder} store it.
 */
export function familyAt(family: readonly Row[], dishQuantity: number): Map<string, number> {
  const [dish, ...children] = family;
  const quantity = thousandthsToDecimal(dishQuantity);
  const kept = keptExtrasOf(
    children.map((row) => ({
      id: row.id,
      quantity: row.quantity,
      priceQuantity: row.priceQuantity,
      unitPriceGross: row.unit,
    })),
    dish!.quantity,
  );
  return new Map([
    [dish!.id, dishQuantity],
    ...kept.map(
      ({ child, perDish }) =>
        [
          child.id,
          decimalToThousandths(extraQuantityFor(perDish, quantity, child.priceQuantity)),
        ] as const,
    ),
  ]);
}

/** {@link Approval} on the wire: the limit as money is written. */
export type WireApproval =
  | {
      by: "limit";
      permission: "adjustment.approve";
      limit: { kind: "reason" | "bill"; amount: string | null; percentBp: number | null };
    }
  | { by: "refund"; permission: "sale.refund" };

export function wireApproval(approval: Approval): WireApproval {
  return approval.by === "limit"
    ? {
        ...approval,
        limit: {
          ...approval.limit,
          amount: approval.limit.amount === null ? null : money(approval.limit.amount),
        },
      }
    : approval;
}
