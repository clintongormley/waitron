import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { adjustmentLines } from "@waitron/adjustments";
import {
  orderPortionEvents,
  orderPortions,
  saleLinePortions,
  saleLines,
  workingLinePortions,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import type { PortionBinding } from "./portion-sale-projection.js";
import type { OrderLineIdentity, PricedTabRound } from "./working-order.js";

type Row = PricedTabRound["rows"][number];

/** A dish a priced round wrote, and the permanent portion it holds. */
export interface PortionRef {
  portionId: string;
  lineId: string;
  /** 1 to n within its pricing cohort. */
  ordinal: number;
  /** The portions expanded from one priced request line. */
  pricingCohortId: string;
  /** Sold by weight, in decimals or in a measure: one portion, never split. */
  measured: boolean;
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
): { rows: Row[]; lineContexts: C[]; portions: PortionRef[]; requestOfRow: number[] } {
  const out: Row[] = [];
  const contexts: C[] = [];
  const portions: PortionRef[] = [];
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
    const cohort = randomUUID();
    for (let ordinal = 1; ordinal <= count; ordinal++) {
      const id = ordinal === 1 ? row.id! : randomUUID();
      out.push({ ...share(row, count), id });
      contexts.push({ ...lineContexts[i]!, workingOrderLineId: id });
      requestOfRow.push(request);
      portions.push({
        portionId: randomUUID(),
        lineId: id,
        ordinal,
        pricingCohortId: cohort,
        measured: portionable[i] !== true,
      });
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
    portions,
    requestOfRow,
  };
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

/**
 * Record each portion and bind it to its line. A line already holding the same portion is left as
 * it is; a line holding another portion is a bug and is refused.
 */
export async function registerPortions(
  tx: Transaction,
  portions: readonly PortionRef[],
): Promise<void> {
  const bound = await readPortionBindings(
    tx,
    portions.map((portion) => portion.lineId),
  );
  for (const portion of portions) {
    const held = bound.get(portion.lineId);
    if (held?.portionId === portion.portionId) continue;
    if (held !== undefined)
      throw new Error(
        `registerPortions: line ${portion.lineId} already holds portion ${held.portionId}, not ${portion.portionId}`,
      );
    await tx.insert(orderPortions).values({
      id: portion.portionId,
      cohortId: portion.pricingCohortId,
      ordinal: portion.ordinal,
      measured: portion.measured,
    });
    await tx
      .insert(workingLinePortions)
      .values({ workingOrderLineId: portion.lineId, portionId: portion.portionId });
  }
}

/** For each `{ from, to }` copy, what each comp or discount took off `from` it took off `to` as
 * well. */
export async function copyCoveredLines(
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
    .where(
      inArray(
        adjustmentLines.lineId,
        pairs.map(({ from }) => from),
      ),
    );
  const rows = pairs.flatMap(({ from, to }) =>
    covered.filter((row) => row.lineId === from).map((row) => ({ ...row, lineId: to })),
  );
  if (rows.length > 0) await tx.insert(adjustmentLines).values(rows);
}

/** The portion each of `lineIds` holds; a line holding none is absent. */
export async function readPortionBindings(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<Map<string, PortionBinding>> {
  if (lineIds.length === 0) return new Map();
  const rows = await tx
    .select({
      lineId: workingLinePortions.workingOrderLineId,
      portionId: orderPortions.id,
      cohortId: orderPortions.cohortId,
      ordinal: orderPortions.ordinal,
    })
    .from(workingLinePortions)
    .innerJoin(orderPortions, eq(orderPortions.id, workingLinePortions.portionId))
    .where(inArray(workingLinePortions.workingOrderLineId, [...lineIds]));
  return new Map(rows.map((row) => [row.lineId, row]));
}

/** A raised dish's portion: its cohort and whether it is measured. */
export interface GrowingPortion {
  cohortId: string;
  measured: boolean;
  /** One past the cohort's highest ordinal when read, the same for every line of the cohort. */
  nextOrdinal: number;
}

/** The portion each of `lineIds` holds, as a rise needs it; a line holding none is absent. */
export async function readGrowingPortions(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<Map<string, GrowingPortion>> {
  if (lineIds.length === 0) return new Map();
  const cohort = alias(orderPortions, "cohort");
  const rows = await tx
    .select({
      lineId: workingLinePortions.workingOrderLineId,
      cohortId: orderPortions.cohortId,
      measured: orderPortions.measured,
      lastOrdinal: sql<number>`max(${cohort.ordinal})`,
    })
    .from(workingLinePortions)
    .innerJoin(orderPortions, eq(orderPortions.id, workingLinePortions.portionId))
    .innerJoin(cohort, eq(cohort.cohortId, orderPortions.cohortId))
    .where(inArray(workingLinePortions.workingOrderLineId, [...lineIds]))
    .groupBy(
      workingLinePortions.workingOrderLineId,
      orderPortions.cohortId,
      orderPortions.measured,
    );
  return new Map(
    rows.map((row) => [
      row.lineId,
      { cohortId: row.cohortId, measured: row.measured, nextOrdinal: row.lastOrdinal + 1 },
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
  const rows = await tx
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .innerJoin(
      workingLinePortions,
      eq(
        workingLinePortions.workingOrderLineId,
        sql`coalesce(${workingOrderLines.parentLineId}, ${workingOrderLines.id})`,
      ),
    )
    .innerJoin(
      orderPortions,
      and(eq(orderPortions.id, workingLinePortions.portionId), eq(orderPortions.measured, false)),
    )
    .where(inArray(workingOrderLines.id, [...lineIds]));
  return new Set(rows.map((row) => row.id));
}

/** Unbind `lineIds` before their lines are deleted (the binding's key has no delete rule). */
export async function deletePortionBindings(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<void> {
  if (lineIds.length === 0) return;
  await tx
    .delete(workingLinePortions)
    .where(inArray(workingLinePortions.workingOrderLineId, [...lineIds]));
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
            portionId: binding.portionId,
            kind: event.kind,
            fromOrderId: event.fromOrderId,
            toOrderId: event.kind === "moved" ? event.toOrderId : null,
            actorId: event.actorId,
          },
        ];
  });
  if (rows.length > 0) await tx.insert(orderPortionEvents).values(rows);
}

/**
 * Before `lineIds` are deleted with their charge: record each held portion as cancelled and unbind
 * it. The registry row stays.
 */
export async function cancelPortions(
  tx: Transaction,
  orderId: string,
  lineIds: readonly string[],
  actorId: string | null,
): Promise<void> {
  await recordPortionEvents(tx, lineIds, { kind: "cancelled", fromOrderId: orderId, actorId });
  await deletePortionBindings(tx, lineIds);
}

/**
 * Link each row `recordSale` just filed to the portions it stands for. `identities[i]` is the row
 * filed as line `i + 1`, the number `grossRows` gives it and `saleLineRows` keeps.
 */
export async function linkSalePortions(
  tx: Transaction,
  saleId: string,
  identities: readonly Pick<OrderLineIdentity, "portionIds">[],
): Promise<void> {
  if (!identities.some((identity) => (identity.portionIds?.length ?? 0) > 0)) return;
  const filed = await tx
    .select({ id: saleLines.id, lineNo: saleLines.lineNo })
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId));
  const rowOf = new Map(filed.map((row) => [row.lineNo, row.id]));
  const links = identities.flatMap((identity, i) => {
    const saleLineId = rowOf.get(i + 1);
    if (saleLineId === undefined)
      throw new Error(`linkSalePortions: sale ${saleId} filed no line ${i + 1}`);
    return (identity.portionIds ?? []).map((portionId) => ({ saleLineId, portionId }));
  });
  await tx.insert(saleLinePortions).values(links);
}
