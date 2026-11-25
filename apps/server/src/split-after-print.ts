import { eq } from "drizzle-orm";
import {
  newId,
  insertInChunks,
  lineServiceCancellations,
  sales,
  unpaidDepartures,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import {
  correctionTargetFor,
  requireSupportedCorrection,
  withIssuanceTransaction,
} from "@waitron/core";
import { AppError } from "@waitron/shared";
import { creditWholeInvoice, type IssuedInvoice } from "./cancel-credit.js";
import { copyAllergyWorkingTicks } from "./kitchen-allergy.js";
import { readSplitOrderLabel } from "./receipt-order.js";
import { unservedDishes } from "./meal-end.js";
import { carryLineReductions } from "./order-portions.js";
import { bumpPartyRevision } from "./parties.js";
import { carryBillSetMenuCopies } from "./set-menu-bill.js";
import { carryReceivedPayments, refuseSplitMoney } from "./split-after-print-money.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import {
  abandonPlacedOrder,
  lockPlacedOrder,
  recordPlacedOrderCancelled,
} from "./working-order-counter.js";
import { createOpenOrder } from "./working-order-open.js";
import { readInvoiceNumber } from "./stored-order-lines.js";
import { type TillSaleDeps } from "./working-order-context.js";
import "./errors.js";

export interface SplitAfterPrint {
  billId: string;
  correctiveNumber: string;
}

/** A printed bill reopened: its new open bill, the corrective filed, and each dish's copy. */
export interface ReopenedBill extends SplitAfterPrint {
  /** Each dish of the printed bill, by id, to its copy on the new bill. */
  lineCopies: Map<string, string>;
}

/**
 * Credit a table's printed, unpaid ticket in full and put copies of its dishes on a new open bill
 * of the same party, so each guest's dishes can be moved to their own bill and printed. Refuses in
 * the order the till offers the fix: the bill's state, then its money, then its unserved dishes.
 */
export async function splitAfterPrint(
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  id: string,
  operator: { personId: string; sessionId: string },
): Promise<SplitAfterPrint> {
  return withIssuanceTransaction(deps.db, async (tx) => {
    const { billId, correctiveNumber } = await reopenToSplitIn(tx, deps, cfg, id, operator);
    return { billId, correctiveNumber };
  });
}

/** Reopen to split's refusals, which write nothing; answers the bill's party and ticket. */
export async function refuseReopen(
  tx: Transaction,
  deps: Pick<TillSaleDeps, "admission">,
  cfg: DeviceRequestConfig,
  id: string,
): Promise<{ partyId: string; invoice: IssuedInvoice }> {
  const placed = await lockPlacedOrder(tx, deps, cfg, id);
  const refused = await refuseSplitBill(tx, id, placed.partyId, placed.invoice);
  await refuseSplitMoney(tx, id);
  await refuseUnservedDishes(tx, id);
  return refused;
}

/**
 * {@link splitAfterPrint} inside the caller's issuance transaction. The new bill names the printed
 * one in `reopened_from` while that is still `placed`, which is what lets the credit be filed for
 * the session's person without `sale.rectify`.
 */
export async function reopenToSplitIn(
  tx: Transaction,
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  id: string,
  operator: { personId: string; sessionId: string },
): Promise<ReopenedBill> {
  const { partyId, invoice } = await refuseReopen(tx, deps, cfg, id);
  const opened = await openSplitBill(tx, cfg, id, partyId);
  const correctiveId = await creditWholeInvoice(tx, deps, cfg, invoice, {
    reopenedBillId: opened.billId,
    tillSessionId: operator.sessionId,
  });
  await abandonPlacedOrder(tx, cfg, id);
  await carryReceivedPayments(tx, id, opened.billId);
  await bumpPartyRevision(tx, partyId);
  await recordPlacedOrderCancelled(
    tx,
    deps,
    cfg,
    id,
    operator.personId,
    `Bill split after printing to bill ${opened.billNumber}`,
  );
  return {
    billId: opened.billId,
    correctiveNumber: await readInvoiceNumber(tx, correctiveId),
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
  if (partyId === null) throw new AppError("bill.not_at_table", { workingOrderId: id });
  const [departure] = await tx
    .select({ id: unpaidDepartures.workingOrderId })
    .from(unpaidDepartures)
    .where(eq(unpaidDepartures.workingOrderId, id));
  if (departure !== undefined) throw new AppError("bill.left_unpaid", { workingOrderId: id });
  if (invoice === undefined) throw new AppError("bill.not_issued", { workingOrderId: id });
  // `recordCorrection` refuses the same invoice, but only after the dishes.
  const target = await correctionTargetFor(tx, invoice.id);
  const [credited] = await tx
    .select({ counterpartyTaxId: sales.counterpartyTaxId })
    .from(sales)
    .where(eq(sales.id, target));
  requireSupportedCorrection(credited!.counterpartyTaxId, target);
  return { partyId, invoice };
}

async function refuseUnservedDishes(tx: Transaction, id: string): Promise<void> {
  const dishes = await unservedDishes(tx, id);
  if (dishes.length > 0) throw new AppError("bill.unserved_dishes", { workingOrderId: id, dishes });
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
