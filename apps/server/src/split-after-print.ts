import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
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
import { authorize, type Override, type PinAttempts } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { creditWholeInvoice, type IssuedInvoice } from "./cancel-credit.js";
import { copyAllergyWorkingTicks } from "./kitchen-allergy.js";
import { orderTableLabel } from "./kitchen-print.js";
import { unservedDishes } from "./meal-end.js";
import { carryLineReductions } from "./order-portions.js";
import { bumpPartyRevision } from "./parties.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import {
  abandonPlacedOrder,
  createOpenOrder,
  lockPlacedOrder,
  readInvoiceNumber,
  recordPlacedOrderCancelled,
  refusePlacedOrderMoney,
  withRectifyPinAhead,
  type TillSaleDeps,
} from "./working-order.js";
import "./errors.js";

export interface SplitAfterPrint {
  billId: string;
  correctiveNumber: string;
}

/**
 * Credit a table's printed, unpaid ticket in full and put copies of its dishes on a new open bill
 * of the same party, so each guest's dishes can be moved to their own bill and printed. Refuses in
 * the order the till offers the fix: the bill's state, then its money, then its unserved dishes,
 * then the permission.
 */
export async function splitAfterPrint(
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  id: string,
  operator: { personId: string; sessionId: string; attempts: PinAttempts },
  override?: Override,
): Promise<SplitAfterPrint> {
  return withRectifyPinAhead(deps, id, operator, override, (checkedOverride) =>
    withIssuanceTransaction(deps.db, async (tx) => {
      const authz = { sessionId: operator.sessionId, override: checkedOverride };
      const placed = await lockPlacedOrder(tx, deps, cfg, id);
      const { partyId, invoice } = await refuseSplitBill(tx, id, placed.partyId, placed.invoice);
      await refusePlacedOrderMoney(tx, id);
      await refuseUnservedDishes(tx, id);
      await authorize(tx, { ...authz, permission: "sale.rectify" }, operator.attempts);
      const correctiveId = await creditWholeInvoice(tx, deps, cfg, invoice, authz);
      await abandonPlacedOrder(tx, cfg, id);
      const opened = await openSplitBill(tx, cfg, id, partyId);
      await bumpPartyRevision(tx, partyId);
      await recordPlacedOrderCancelled(
        tx,
        deps,
        cfg,
        id,
        operator.personId,
        `Bill split after printing to bill ${opened.billNumber}`,
      );
      return { billId: opened.billId, correctiveNumber: await readInvoiceNumber(tx, correctiveId) };
    }),
  );
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
  // `recordCorrection` refuses the same invoice, but only after the dishes and the permission.
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
): Promise<{ billId: string; billNumber: number }> {
  const [from] = await tx
    .select({ receiptLocale: workingOrders.receiptLocale })
    .from(workingOrders)
    .where(eq(workingOrders.id, fromBillId));
  const billId = randomUUID();
  const { billNumber } = await createOpenOrder(
    tx,
    cfg,
    billId,
    [],
    await orderTableLabel(tx, fromBillId),
    {
      partyId,
      existingService: true,
      copyServiceContextFrom: fromBillId,
      ...(from!.receiptLocale === null ? {} : { receiptLocale: from!.receiptLocale }),
    },
  );
  await copyBillDishes(tx, fromBillId, billId);
  return { billId, billNumber: billNumber! };
}

/**
 * Copies every line of `fromBillId` onto `toBillId`, which holds none. Kitchen state, print links and
 * sale links stay with the originals.
 */
export async function copyBillDishes(
  tx: Transaction,
  fromBillId: string,
  toBillId: string,
): Promise<void> {
  const rows = await tx
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, fromBillId))
    .orderBy(workingOrderLines.lineNo);
  // Print the bill refuses a bill holding set-menu lines, so a printed bill never reaches here
  // with one; their copies would also need `bill_set_menu_copies`.
  if (rows.some((row) => row.setMenuRole !== null))
    throw new Error(`copyBillDishes: bill ${fromBillId} holds set-menu lines`);
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
      lineNo: index + 1,
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
}
