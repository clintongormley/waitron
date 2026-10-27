import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { orderPortions, workingLinePortions, type Transaction } from "@waitron/db";
import type { PortionBinding } from "./portion-sale-projection.js";
import type { PricedTabRound } from "./working-order.js";

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
