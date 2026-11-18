import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { adjustmentLines } from "@waitron/adjustments";
import {
  insertInChunks,
  orderPortionEvents,
  saleLineDishes,
  saleLines,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { AppError, PORTIONS_AT_ONCE } from "@waitron/shared";
import type { PortionBinding } from "./portion-sale-projection.js";
import "./errors.js";
import type { OrderLineIdentity, PricedTabRound } from "./working-order.js";

type Row = PricedTabRound["rows"][number];

/** Refuses adding `count` portions of one dish in one write. */
export function refuseTooManyPortions(count: number): void {
  if (count > PORTIONS_AT_ONCE)
    throw new AppError("tab.portions_too_many", { limit: PORTIONS_AT_ONCE });
}

/**
 * Split each whole-portion dish of quantity n into n dish rows of 1, each followed by its own
 * extras at the per-dish quantity, and number every row from `firstLineNo`. The first portion keeps
 * the priced row's id. `portionable` is aligned with `rows`; `requestOfRow` gives each output row's
 * request line.
 */
export function expandPortionRows<C extends { workingOrderLineId: string }>(
  rows: readonly Row[],
  lineContexts: readonly C[],
  portionable: readonly boolean[],
  firstLineNo: number,
): { rows: Row[]; lineContexts: C[]; requestOfRow: number[] } {
  const out: Row[] = [];
  const contexts: C[] = [];
  const requestOfRow: number[] = [];
  const extrasOf = new Map<string, { child: Row; context: C }[]>();
  rows.forEach((child, j) => {
    if (child.parentLineId == null) return;
    const extras = extrasOf.get(child.parentLineId) ?? [];
    extras.push({ child, context: lineContexts[j]! });
    extrasOf.set(child.parentLineId, extras);
  });
  let request = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.parentLineId != null) continue;
    request += 1;
    const extras = extrasOf.get(row.id!) ?? [];
    const count = portionable[i] === true ? row.quantity / 1000 : 1;
    if (!Number.isInteger(count))
      throw new Error(
        `expandPortionRows: line ${row.id}'s quantity ${row.quantity} is not a whole number of portions`,
      );
    refuseTooManyPortions(count);
    const cohort = randomUUID();
    for (let ordinal = 1; ordinal <= count; ordinal++) {
      const id = ordinal === 1 ? row.id! : randomUUID();
      out.push({
        ...share(row, count),
        id,
        cohortId: cohort,
        cohortOrdinal: ordinal,
        wholePortion: portionable[i] === true,
      });
      contexts.push({ ...lineContexts[i]!, workingOrderLineId: id });
      requestOfRow.push(request);
      for (const { child, context } of extras) {
        const childId = ordinal === 1 ? child.id! : randomUUID();
        out.push({ ...share(child, count), id: childId, parentLineId: id });
        contexts.push({ ...context, workingOrderLineId: childId });
        requestOfRow.push(request);
      }
    }
  }
  return {
    rows: out.map((row, i) => ({ ...row, lineNo: firstLineNo + i })),
    lineContexts: contexts,
    requestOfRow,
  };
}

/**
 * Each priced row's identity with its expanded lines and dish links, as
 * `projectPortionSale` reads them back: a dish row lists its portions' dish lines, an extra row that
 * extra's copy under each dish, and both link to the dish lines. `identities` and `requestRows`
 * are aligned, as `priceOrderLines` returns them; `expanded` is `expandPortionRows` of `requestRows`.
 */
export function portionIdentities(
  identities: readonly OrderLineIdentity[],
  requestRows: readonly Row[],
  expanded: Pick<ReturnType<typeof expandPortionRows>, "rows" | "requestOfRow">,
): OrderLineIdentity[] {
  const indexOf = new Map(requestRows.map((row, i) => [row.id!, i]));
  const dishes: number[] = [];
  const extrasOf = new Map<number, number[]>();
  requestRows.forEach((row, i) => {
    if (row.parentLineId == null) {
      dishes.push(i);
      return;
    }
    const parent = indexOf.get(row.parentLineId)!;
    const extras = extrasOf.get(parent) ?? [];
    extras.push(i);
    extrasOf.set(parent, extras);
  });
  const lineIds = requestRows.map((): string[] => []);
  let extrasLeft: number[] = [];
  expanded.rows.forEach((row, k) => {
    const dish = dishes[expanded.requestOfRow[k]!]!;
    if (row.parentLineId == null) {
      lineIds[dish]!.push(row.id!);
      extrasLeft = [...(extrasOf.get(dish) ?? [])];
    } else {
      lineIds[extrasLeft.shift()!]!.push(row.id!);
    }
  });
  return identities.map((identity, i) => {
    const parent = requestRows[i]!.parentLineId;
    const dish = parent == null ? i : indexOf.get(parent)!;
    return { ...identity, lineIds: lineIds[i]!, dishLineIds: lineIds[dish]! };
  });
}

/** One dish's share of a row priced for `count` dishes, exact in cents and thousandths. */
function share(row: Row, count: number): Row {
  if (count === 1) return { ...row };
  if (row.lineTotal % count !== 0 || row.quantity % count !== 0)
    throw new Error(
      `expandPortionRows: line ${row.id}'s total ${row.lineTotal} does not split into ${count} equal portions`,
    );
  return { ...row, quantity: row.quantity / count, lineTotal: row.lineTotal / count };
}

/** For each `{ from, to }`, a copy or a part split off `from`, give `to` every row of what a comp or
 * discount took off `from`, its amount and quantity unchanged: a row says what was taken off the
 * quantity its line held then. */
export async function carryLineReductions(
  tx: Transaction,
  pairs: readonly { from: string; to: string }[],
): Promise<void> {
  if (pairs.length === 0) return;
  const covered = await tx
    .select({
      adjustmentId: adjustmentLines.adjustmentId,
      lineId: adjustmentLines.lineId,
      reduction: adjustmentLines.reduction,
      quantity: adjustmentLines.quantity,
    })
    .from(adjustmentLines)
    .where(inArray(adjustmentLines.lineId, [...new Set(pairs.map(({ from }) => from))]));
  const byLine = new Map<string, typeof covered>();
  for (const row of covered) {
    const held = byLine.get(row.lineId);
    if (held === undefined) byLine.set(row.lineId, [row]);
    else held.push(row);
  }
  const rows = pairs.flatMap(({ from, to }) =>
    (byLine.get(from) ?? []).map((row) => ({ ...row, lineId: to })),
  );
  await insertInChunks(tx, adjustmentLines, rows);
}

/** The portion each of `lineIds` holds; a line holding none is absent. */
export async function readPortionBindings(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<Map<string, PortionBinding>> {
  if (lineIds.length === 0) return new Map();
  const rows = await tx
    .select({
      lineId: workingOrderLines.id,
      cohortId: workingOrderLines.cohortId,
      ordinal: workingOrderLines.cohortOrdinal,
    })
    .from(workingOrderLines)
    .where(
      and(
        isNotNull(workingOrderLines.cohortId),
        inArray(
          workingOrderLines.id,
          sql`(select value from json_each(${JSON.stringify(lineIds)}))`,
        ),
      ),
    );
  return new Map(
    rows.map(({ lineId, cohortId, ordinal }) => [
      lineId,
      { lineId, cohortId: cohortId!, ordinal: ordinal! },
    ]),
  );
}

/** A raised dish's portion: its cohort and whether it is measured. */
export interface GrowingPortion {
  cohortId: string;
  measured: boolean;
  /** One past the cohort's highest ordinal when read, the same for every line of the cohort. */
  nextOrdinal: number;
}

/**
 * Whether raising a stored dish of `quantity` to `requested` thousandths adds copies of its whole
 * portion, the row itself keeping `quantity`, rather than raising the row in place.
 */
export function risesByCopies(
  quantity: number,
  requested: number,
  portion: GrowingPortion | undefined,
): boolean {
  return requested > quantity && portion !== undefined && !portion.measured;
}

/** The portion each of `lineIds` holds, as a rise needs it; a line holding none is absent. */
export async function readGrowingPortions(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<Map<string, GrowingPortion>> {
  if (lineIds.length === 0) return new Map();
  const cohort = alias(workingOrderLines, "cohort");
  const rows = await tx
    .select({
      lineId: workingOrderLines.id,
      cohortId: workingOrderLines.cohortId,
      whole: workingOrderLines.wholePortion,
      lastOrdinal: sql<number>`max(${cohort.cohortOrdinal})`,
    })
    .from(workingOrderLines)
    .innerJoin(cohort, eq(cohort.cohortId, workingOrderLines.cohortId))
    .where(inArray(workingOrderLines.id, [...lineIds]))
    .groupBy(workingOrderLines.id, workingOrderLines.cohortId, workingOrderLines.wholePortion);
  return new Map(
    rows.map((row) => [
      row.lineId,
      { cohortId: row.cohortId!, measured: row.whole === false, nextOrdinal: row.lastOrdinal + 1 },
    ]),
  );
}

/**
 * Of `lineIds`, the dish lines bound to a portion that is not measured, and their extras: the lines
 * kitchen paper prints once for several identical portions.
 */
export async function readWholePortionLines(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<Set<string>> {
  if (lineIds.length === 0) return new Set();
  const dish = alias(workingOrderLines, "dish");
  const rows = await tx
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .innerJoin(
      dish,
      and(
        eq(dish.id, sql`coalesce(${workingOrderLines.parentLineId}, ${workingOrderLines.id})`),
        eq(dish.wholePortion, true),
      ),
    )
    .where(inArray(workingOrderLines.id, [...lineIds]));
  return new Set(rows.map((row) => row.id));
}

export type PortionEvent =
  | { kind: "moved"; fromOrderId: string; toOrderId: string; actorId: string | null }
  | { kind: "cancelled"; fromOrderId: string; actorId: string | null };

/** Record `event` for the portion each of `lineIds` holds; a line holding none records nothing. */
export async function recordPortionEvents(
  tx: Transaction,
  lineIds: readonly string[],
  event: PortionEvent,
): Promise<void> {
  const bound = await readPortionBindings(tx, lineIds);
  const rows = lineIds.flatMap((lineId) => {
    const binding = bound.get(lineId);
    return binding === undefined
      ? []
      : [
          {
            lineId,
            detail: { cohortId: binding.cohortId, ordinal: binding.ordinal },
            kind: event.kind,
            fromOrderId: event.fromOrderId,
            toOrderId: event.kind === "moved" ? event.toOrderId : null,
            actorId: event.actorId,
          },
        ];
  });
  await insertInChunks(tx, orderPortionEvents, rows);
}

/** Record the dish identity before its line is deleted with the charge. */
export async function cancelPortions(
  tx: Transaction,
  orderId: string,
  lineIds: readonly string[],
  actorId: string | null,
): Promise<void> {
  await recordPortionEvents(tx, lineIds, { kind: "cancelled", fromOrderId: orderId, actorId });
}

/**
 * Link each row `recordSale` just filed to the portions it stands for. `identities[i]` is the row
 * filed as line `i + 1`, the number `grossRows` gives it and `saleLineRows` keeps.
 */
export async function linkSaleDishes(
  tx: Transaction,
  saleId: string,
  identities: readonly Pick<OrderLineIdentity, "dishLineIds">[],
): Promise<void> {
  if (!identities.some((identity) => (identity.dishLineIds?.length ?? 0) > 0)) return;
  const filed = await tx
    .select({ id: saleLines.id, lineNo: saleLines.lineNo })
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId));
  const rowOf = new Map(filed.map((row) => [row.lineNo, row.id]));
  const links = identities.flatMap((identity, i) => {
    const saleLineId = rowOf.get(i + 1);
    if (saleLineId === undefined)
      throw new Error(`linkSaleDishes: sale ${saleId} filed no line ${i + 1}`);
    return (identity.dishLineIds ?? []).map((dishLineId) => ({ saleLineId, dishLineId }));
  });
  await insertInChunks(tx, saleLineDishes, links);
}
