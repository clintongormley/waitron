import { eq, inArray } from "drizzle-orm";
import {
  newId,
  insertInChunks,
  lineServiceCancellations,
  orderGroups,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { withIssuanceTransaction } from "@waitron/core";
import { AppError, stringToThousandths } from "@waitron/shared";
import { holdsPayment } from "./bill-payments.js";
import { billReopenRefusal } from "./bill-reopen-state.js";
import { creditWholeInvoice, type IssuedInvoice } from "./cancel-credit.js";
import { copyAllergyWorkingTicks } from "./kitchen-allergy.js";
import { readSplitOrderLabel } from "./receipt-order.js";
import { dishKitchenItems } from "./dish-kitchen.js";
import { isStarted } from "./kitchen-ticket-state.js";
import {
  enqueueServiceCancellation,
  serviceCancellationFamilies,
  writeServiceCancellations,
} from "./line-service-cancel.js";
import { unservedDishes, type UnservedBillDish } from "./meal-end.js";
import { carryLineReductions } from "./order-portions.js";
import { bumpPartyRevision } from "./parties.js";
import { carryBillSetMenuCopies } from "./set-menu-bill.js";
import { carryOrderedPeriods } from "./ordered-periods.js";
import { carryReceivedPayments, refuseSplitMoney } from "./split-after-print-money.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import {
  abandonPlacedOrder,
  lockPlacedOrder,
  recordPlacedOrderCancelled,
  type BillRead,
} from "./working-order-counter.js";
import { createOpenOrder } from "./working-order-open.js";
import { servedOrCharged } from "./served-dishes.js";
import { readInvoiceNumber } from "./stored-order-lines.js";
import { removeFromLine } from "./working-order-removal.js";
import { type TillSaleDeps } from "./working-order-context.js";
import "./errors.js";

export interface SplitAfterPrint {
  billId: string;
  correctiveNumber: string;
}

/** A printed bill reopened: its new open bill and its party, the corrective filed, and each dish's
 * copy. */
export interface ReopenedBill extends SplitAfterPrint {
  party: { id: string; revision: number };
  /** Each dish of the printed bill, by id, to its copy on the new bill. */
  lineCopies: Map<string, string>;
}

/**
 * Credit a table's printed ticket in full and put copies of its dishes on a new open bill of the
 * same party, so each guest's dishes can be moved to their own bill and printed; the copies leave
 * out the dishes `stopUnserved` stops that the kitchen had not started. Refuses in the order the
 * till offers the fix: the bill's state, then its money, then its unserved dishes.
 */
export async function splitAfterPrint(
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  id: string,
  operator: { personId: string; sessionId: string },
  stopUnserved = false,
): Promise<SplitAfterPrint> {
  return withIssuanceTransaction(deps.db, async (tx) => {
    const { billId, correctiveNumber } = await reopenToSplitIn(
      tx,
      deps,
      cfg,
      id,
      operator,
      undefined,
      stopUnserved,
    );
    return { billId, correctiveNumber };
  });
}

/** Reopen bill's refusals, which write nothing; answers the bill's party and ticket, and the
 * unserved dishes `stopUnserved` lets through. `read` is the bill as the caller has read it in
 * this transaction, when it has. */
export async function refuseReopen(
  tx: Transaction,
  deps: Pick<TillSaleDeps, "admission">,
  cfg: DeviceRequestConfig,
  id: string,
  read?: BillRead,
  stopUnserved = false,
): Promise<{ partyId: string; invoice: IssuedInvoice; unserved: UnservedBillDish[] }> {
  const placed = await lockPlacedOrder(tx, deps, cfg, id, read);
  const refused = await refuseSplitBill(tx, id, placed.partyId, placed.invoice);
  await refuseSplitMoney(tx, id);
  return { ...refused, unserved: await refuseUnservedDishes(tx, id, stopUnserved) };
}

/**
 * {@link splitAfterPrint} inside the caller's issuance transaction. The new bill, open, names the
 * printed one in `reopened_from` and holds copies of its dishes, so `authorizeReopenedCredit` files
 * the whole credit for the session's person without `sale.rectify`.
 */
export async function reopenToSplitIn(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  id: string,
  operator: { personId: string; sessionId: string },
  read?: BillRead,
  stopUnserved = false,
): Promise<ReopenedBill> {
  const { partyId, invoice, unserved } = await refuseReopen(tx, deps, cfg, id, read, stopUnserved);
  const opened = await openSplitBill(tx, cfg, id, partyId);
  const started = await stopHeldDishes(tx, cfg, id, unserved);
  const correctiveId = await creditWholeInvoice(tx, deps, cfg, invoice, {
    reopenedBillId: opened.billId,
    tillSessionId: operator.sessionId,
  });
  await abandonPlacedOrder(tx, cfg, id);
  await carryReceivedPayments(tx, id, opened.billId);
  await takeOffCopies(tx, cfg, opened, unserved, started, operator.personId);
  const revision = (await bumpPartyRevision(tx, partyId))!;
  await recordPlacedOrderCancelled(
    tx,
    deps,
    cfg,
    id,
    operator.personId,
    `Bill split after printing to bill ${opened.billNumber}${unserved.length > 0 ? "; dishes not served were stopped" : ""}`,
  );
  return {
    billId: opened.billId,
    correctiveNumber: await readInvoiceNumber(tx, correctiveId),
    party: { id: partyId, revision },
    lineCopies: opened.lineCopies,
  };
}

/** The bill's own refusals, ahead of its money's: each says why this bill cannot be reopened. */
async function refuseSplitBill(
  tx: Transaction,
  id: string,
  partyId: string | null,
  invoice: IssuedInvoice | undefined,
): Promise<{ partyId: string; invoice: IssuedInvoice }> {
  const refusal = await billReopenRefusal(tx, id, partyId, invoice?.id);
  if (refusal !== undefined) throw refusal;
  return { partyId: partyId!, invoice: invoice! };
}

async function refuseUnservedDishes(
  tx: Transaction,
  id: string,
  stopUnserved: boolean,
): Promise<UnservedBillDish[]> {
  const dishes = await unservedDishes(tx, id);
  if (dishes.length === 0) return dishes;
  // Not offered on a bill holding a payment: stopping dishes could leave the reopened bill owing
  // less than it has received.
  const canStop = (await servedOrCharged(tx, id)).length > 0 && !(await holdsPayment(tx, id));
  if (!stopUnserved || !canStop)
    throw new AppError("bill.unserved_dishes", { workingOrderId: id, dishes, canStop });
  return dishes;
}

/**
 * Stops each unfired kitchen item of the unserved dishes, a dish's or an extra's, as a cancel of a
 * sent dish does; abandoning the bill voids every fired quantity still unserved, so each item is
 * corrected once. Answers each dish the kitchen had started, with its extras the kitchen had not.
 */
async function stopHeldDishes(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  billId: string,
  unserved: readonly UnservedBillDish[],
): Promise<Map<string, string[]>> {
  const work = await dishKitchenItems(
    tx,
    unserved.map(({ lineId }) => lineId),
  );
  const unfired = new Map(
    [...work].map(([lineId, items]) => [lineId, items.filter((item) => item.firedAt === null)]),
  );
  const held = unserved.filter(({ lineId }) => (unfired.get(lineId)?.length ?? 0) > 0);
  if (held.length > 0) {
    const rows = await tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId));
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const taken = held.map(({ lineId, quantity }) => ({
      dish: rowById.get(lineId)!,
      off: stringToThousandths(quantity),
    }));
    const priors = await tx
      .select()
      .from(lineServiceCancellations)
      .where(
        inArray(
          lineServiceCancellations.lineId,
          held.map(({ lineId }) => lineId),
        ),
      );
    const groups = await tx
      .select()
      .from(orderGroups)
      .where(
        inArray(
          orderGroups.id,
          taken.flatMap(({ dish }) => dish.groupId ?? []),
        ),
      );
    const groupById = new Map(groups.map((group) => [group.id, group]));
    await enqueueServiceCancellation(
      tx,
      cfg,
      billId,
      serviceCancellationFamilies(rows, taken, priors),
      unfired,
      undefined,
      { groupOf: (dish) => (dish.groupId === null ? undefined : groupById.get(dish.groupId)) },
    );
  }
  return new Map(
    unserved.flatMap(({ lineId }) => {
      const items = work.get(lineId) ?? [];
      if (!items.some((item) => isStarted(item.state))) return [];
      const unstarted = items.filter((item) => item.extra && !isStarted(item.state));
      return [[lineId, unstarted.map((item) => item.workingOrderLineId)] as const];
    }),
  );
}

/**
 * Takes the stopped quantities off the reopened bill's copies as Take off does on an open bill,
 * except a dish the kitchen had started, whose copy keeps its charge and loses each extra the
 * kitchen made apart from it and had not started. A dish with extras is one portion, served only
 * whole, so a started one is stopped whole and those extras come off whole, as Take off removes one.
 */
async function takeOffCopies(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  opened: { billId: string; lineCopies: Map<string, string> },
  unserved: readonly UnservedBillDish[],
  started: ReadonlyMap<string, readonly string[]>,
  operatorId: string,
): Promise<void> {
  const takeOff = async (lineId: string, quantity: number | null) => {
    const [copy] = await tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, opened.lineCopies.get(lineId)!));
    await removeFromLine(
      tx,
      cfg,
      opened.billId,
      {
        ...copy!,
        ticketItemId: null,
        firedAt: null,
        stationId: null,
        state: null,
        firedQuantity: 0,
      },
      quantity === copy!.quantity ? null : quantity,
      operatorId,
    );
  };
  for (const extraId of [...started.values()].flat()) await takeOff(extraId, null);
  if (started.size > 0) {
    const rows = await tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, opened.billId));
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const kept = unserved
      .filter(({ lineId }) => started.has(lineId))
      .map(({ lineId, quantity }) => ({
        dish: rowById.get(opened.lineCopies.get(lineId)!)!,
        off: stringToThousandths(quantity),
      }));
    const priors = await tx
      .select()
      .from(lineServiceCancellations)
      .where(
        inArray(
          lineServiceCancellations.lineId,
          kept.map(({ dish }) => dish.id),
        ),
      );
    await writeServiceCancellations(
      tx,
      serviceCancellationFamilies(rows, kept, priors),
      operatorId,
      true,
    );
  }
  for (const { lineId, quantity } of unserved)
    if (!started.has(lineId)) await takeOff(lineId, stringToThousandths(quantity));
}

/** A new open bill of the party, made as Move dishes makes one, holding copies of the bill's dishes. */
async function openSplitBill(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  fromBillId: string,
  partyId: string,
): Promise<{ billId: string; billNumber: number; lineCopies: Map<string, string> }> {
  const [from] = await tx
    .select({ receiptLocale: workingOrders.receiptLocale })
    .from(workingOrders)
    .where(eq(workingOrders.id, fromBillId));
  const billId = newId();
  const { billNumber } = await createOpenOrder(
    tx,
    cfg,
    billId,
    [],
    await readSplitOrderLabel(tx, fromBillId),
    {
      partyId,
      existingService: true,
      copyServiceContextFrom: fromBillId,
      ...(from!.receiptLocale === null ? {} : { receiptLocale: from!.receiptLocale }),
    },
  );
  await tx
    .update(workingOrders)
    .set({ reopenedFrom: fromBillId })
    .where(eq(workingOrders.id, billId));
  const lineCopies = await copyBillDishes(tx, fromBillId, billId);
  return { billId, billNumber: billNumber!, lineCopies };
}

/**
 * Copies every line of `fromBillId` onto `toBillId`, which holds none, with whether its set menus were
 * proven cheapest, and answers each line's copy by the original's id. Kitchen state, print links and
 * sale links stay with the originals.
 */
export async function copyBillDishes(
  tx: Transaction,
  fromBillId: string,
  toBillId: string,
): Promise<Map<string, string>> {
  const rows = await tx
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, fromBillId))
    .orderBy(workingOrderLines.lineNo);
  const copyOf = new Map(rows.map((row) => [row.id, newId()]));
  // The originals keep their cohorts, and `(cohort_id, cohort_ordinal)` is unique.
  const cohorts = new Map<string, string>();
  const cohortFor = (cohortId: string): string => {
    let copy = cohorts.get(cohortId);
    if (copy === undefined) cohorts.set(cohortId, (copy = newId()));
    return copy;
  };
  const copies = rows.map((row, index) => ({
    ...row,
    id: copyOf.get(row.id)!,
    workingOrderId: toBillId,
    lineNo: index + 1,
    parentLineId: row.parentLineId === null ? null : copyOf.get(row.parentLineId)!,
    setMenuLineId: row.setMenuLineId === null ? null : copyOf.get(row.setMenuLineId)!,
    cohortId: row.cohortId === null ? null : cohortFor(row.cohortId),
  }));
  // A long bill takes several statements, and a row's set menu or dish must already be stored: a set
  // menu's row can come after its dishes.
  const pointedAtFirst = (row: (typeof copies)[number]) =>
    row.setMenuRole === "set_menu" ? 0 : row.parentLineId === null ? 1 : 2;
  await insertInChunks(
    tx,
    workingOrderLines,
    copies.sort((a, b) => pointedAtFirst(a) - pointedAtFirst(b)),
  );
  const pairs = rows.map((row) => ({ from: row.id, to: copyOf.get(row.id)! }));
  await carryLineReductions(tx, pairs);
  await carryBillSetMenuCopies(tx, fromBillId, toBillId);
  await carryOrderedPeriods(tx, fromBillId, toBillId);
  const [from] = await tx
    .select({ setMenusExact: workingOrders.setMenusExact })
    .from(workingOrders)
    .where(eq(workingOrders.id, fromBillId));
  await tx
    .update(workingOrders)
    .set({ setMenusExact: from!.setMenusExact })
    .where(eq(workingOrders.id, toBillId));
  const cancellations = await tx
    .select({ cancellation: lineServiceCancellations })
    .from(lineServiceCancellations)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, lineServiceCancellations.lineId))
    .where(eq(workingOrderLines.workingOrderId, fromBillId));
  await insertInChunks(
    tx,
    lineServiceCancellations,
    cancellations.map(({ cancellation }) => ({
      ...cancellation,
      lineId: copyOf.get(cancellation.lineId)!,
    })),
  );
  await copyAllergyWorkingTicks(
    tx,
    rows
      .filter((row) => row.parentLineId === null)
      .map((row) => ({
        from: row.id,
        to: copyOf.get(row.id)!,
      })),
  );
  return copyOf;
}
