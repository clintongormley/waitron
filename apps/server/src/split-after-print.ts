import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  insertInChunks,
  lineServiceCancellations,
  sales,
  unpaidDepartures,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { correctionTargetFor, requireSupportedCorrection } from "@waitron/core";
import type { Override, PinAttempts } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { readOrderInvoice, type IssuedInvoice } from "./cancel-credit.js";
import { copyAllergyWorkingTicks } from "./kitchen-allergy.js";
import { orderTableLabel } from "./kitchen-print.js";
import { unservedDishes } from "./meal-end.js";
import { carryLineReductions } from "./order-portions.js";
import { overrideToCheck, withCheck, withPinCheckAhead } from "./pin-check-ahead.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import { cancelPlaced, createOpenOrder, type TillSaleDeps } from "./working-order.js";
import "./errors.js";

export interface SplitAfterPrint {
  billId: string;
  creditNoteNumber: string;
}

/**
 * Credit a table's printed, unpaid ticket in full and put copies of its dishes on a new open bill
 * of the same party, so each guest's dishes can be moved to their own bill and printed.
 */
export async function splitAfterPrint(
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  id: string,
  operator: { personId: string; sessionId: string; attempts: PinAttempts },
  override?: Override,
): Promise<SplitAfterPrint> {
  const toCheck =
    (await readOrderInvoice(deps.db, id)) === undefined
      ? undefined
      : await overrideToCheck(
          deps.db,
          { sessionId: operator.sessionId, permission: "sale.rectify" },
          override,
        );
  const split = await withPinCheckAhead(deps.db, toCheck, operator.attempts, (checked) =>
    cancelPlaced(deps, cfg, id, { kind: "split" }, operator, withCheck(override, checked)),
  );
  return split!;
}

/** The bill's own refusals, ahead of its money's: each says why this bill cannot be reopened. */
export async function refuseSplitBill(
  tx: Transaction,
  id: string,
  partyId: string | null,
  invoice: IssuedInvoice | undefined,
): Promise<void> {
  if (partyId === null) throw new AppError("bill.not_at_table", { workingOrderId: id });
  const [departure] = await tx
    .select({ id: unpaidDepartures.workingOrderId })
    .from(unpaidDepartures)
    .where(eq(unpaidDepartures.workingOrderId, id));
  if (departure !== undefined) throw new AppError("bill.left_unpaid", { workingOrderId: id });
  if (invoice === undefined) throw new AppError("bill.not_issued", { workingOrderId: id });
  // `recordCorrection` refuses the same invoice, but only after the dishes and the permission.
  const target = await correctionTargetFor(tx, invoice.id);
  const [credited] = await tx
    .select({ counterpartyTaxId: sales.counterpartyTaxId })
    .from(sales)
    .where(eq(sales.id, target));
  requireSupportedCorrection(credited!.counterpartyTaxId, target);
}

export async function refuseUnservedDishes(tx: Transaction, id: string): Promise<void> {
  const dishes = await unservedDishes(tx, id);
  if (dishes.length > 0) throw new AppError("bill.unserved_dishes", { workingOrderId: id, dishes });
}

/** A new open bill of the party, made as Move dishes makes one, holding copies of the bill's dishes. */
export async function openSplitBill(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  fromBillId: string,
  partyId: string,
): Promise<{ billId: string; billNumber: number }> {
  const [from] = await tx
    .select({ receiptLocale: workingOrders.receiptLocale })
    .from(workingOrders)
    .where(eq(workingOrders.id, fromBillId));
  const billId = randomUUID();
  await createOpenOrder(tx, cfg, billId, [], await orderTableLabel(tx, fromBillId), {
    partyId,
    existingService: true,
    copyServiceContextFrom: fromBillId,
    ...(from!.receiptLocale === null ? {} : { receiptLocale: from!.receiptLocale }),
  });
  await copyBillDishes(tx, fromBillId, billId);
  const [made] = await tx
    .select({ billNumber: workingOrders.billNumber })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  return { billId, billNumber: made!.billNumber! };
}

/**
 * Copy every line of `fromBillId` onto `toBillId` under new ids, in stored line order, with the comps and discounts, service cancellations and allergy ticks the line holds.
 * Kitchen state, print links and sale links stay with the originals. Answers original id → copy id.
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
  // Print the bill refuses a bill holding set-menu lines, so a printed bill never reaches here
  // with one; their copies would also need `bill_set_menu_copies`.
  if (rows.some((row) => row.setMenuRole !== null))
    throw new Error(`copyBillDishes: bill ${fromBillId} holds set-menu lines`);
  const [{ maxLineNo }] = (await tx
    .select({
      maxLineNo: sql<number>`cast(coalesce(max(${workingOrderLines.lineNo}), 0) as int)`,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, toBillId))) as [{ maxLineNo: number }];
  const copyOf = new Map(rows.map((row) => [row.id, randomUUID()]));
  // The originals keep their cohorts, and `(cohort_id, cohort_ordinal)` is unique.
  const cohorts = new Map<string, string>();
  const cohortFor = (cohortId: string): string => {
    let copy = cohorts.get(cohortId);
    if (copy === undefined) cohorts.set(cohortId, (copy = randomUUID()));
    return copy;
  };
  await insertInChunks(
    tx,
    workingOrderLines,
    rows.map((row, index) => ({
      ...row,
      id: copyOf.get(row.id)!,
      workingOrderId: toBillId,
      lineNo: maxLineNo + index + 1,
      parentLineId: row.parentLineId === null ? null : copyOf.get(row.parentLineId)!,
      cohortId: row.cohortId === null ? null : cohortFor(row.cohortId),
    })),
  );
  const pairs = rows.map((row) => ({ from: row.id, to: copyOf.get(row.id)! }));
  await carryLineReductions(tx, pairs);
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
