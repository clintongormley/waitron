import { and, eq, inArray, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { workingOrderLines, workingOrders, type Transaction } from "@waitron/db";
import { staffPresentationName } from "@waitron/catalogue";
import { AppError, thousandthsToDecimal } from "@waitron/shared";
import {
  orderedCancellationContext,
  readCancellationContext,
  type CancellationContext,
} from "./line-cancel-context.js";
import { readLineCancellations, serviceQuantities } from "./line-service-state.js";
import { cancelItem, type CancelItemAsk, type RefundLink } from "./line-cancel.js";
import type { OriginConfig } from "./trading-context.js";
import { moveSettledBillToCounter } from "./move-bill.js";
import { releaseHeldWorkOf } from "./order-groups.js";
import { invalid } from "./bill-allocation.js";
import type { OrderAttendance } from "./working-order.js";
import {
  billOwes,
  finishTable,
  partyFamily,
  partyRevision,
  readFamilyBills,
  requireOpenParty,
  requirePartyClosingEdits,
  runServiceCommand,
} from "./parties.js";
import "./errors.js";

export interface UnservedDish {
  billId: string;
  billRevision: number;
  lineId: string;
  name: string;
  quantity: string;
  context: CancellationContext;
}

export interface FinishCancellation {
  lineId: string;
  quantity: string;
  expectedBillRevision: number;
  expectedContext: CancellationContext;
  preparationStarted?: boolean;
  refundHandoff?: boolean;
  reasonId?: string;
  note?: string;
}

export interface CounterCollection {
  bills: { billId: string; expectedBillRevision: number }[];
}

export type FinishPartyArgs = Parameters<typeof finishTable>[1] & {
  submissionId?: string;
  cancellations?: FinishCancellation[];
  collect?: CounterCollection;
  approver?: CancelItemAsk["approver"];
  refundApprovedBy?: CancelItemAsk["refundApprovedBy"];
};

export type FinishPartyAnswer = { state: "closed"; refundLinks?: RefundLink[] };

export async function finishPartyService(
  tx: Transaction,
  cfg: OriginConfig,
  args: FinishPartyArgs,
  attendance?: OrderAttendance,
): Promise<FinishPartyAnswer> {
  const run = () => finish(tx, cfg, args, attendance);
  if (args.submissionId === undefined) {
    if (args.cancellations !== undefined || args.collect !== undefined)
      throw invalid("submissionId");
    return run();
  }
  return runServiceCommand(
    tx,
    { kind: "party", partyId: args.partyId },
    args.submissionId,
    "party.finish-service",
    {
      ...args,
      approver: undefined,
      refundApprovedBy: undefined,
      approverId: args.approver?.personId,
      cancellations:
        args.cancellations === undefined
          ? undefined
          : args.cancellations
              .map((item) => ({
                ...item,
                expectedContext: orderedCancellationContext(item.expectedContext),
              }))
              .sort((a, b) => a.lineId.localeCompare(b.lineId)),
      collect:
        args.collect === undefined
          ? undefined
          : {
              bills: [...args.collect.bills].sort((a, b) => a.billId.localeCompare(b.billId)),
            },
    },
    run,
    cfg.madeHereSink,
  );
}

async function finish(
  tx: Transaction,
  cfg: OriginConfig,
  args: FinishPartyArgs,
  attendance?: OrderAttendance,
): Promise<FinishPartyAnswer> {
  await requireOpenParty(tx, args.partyId);
  const revision = await partyRevision(tx, args.partyId);
  if (revision !== args.expectedPartyRevision)
    throw new AppError("party.out_of_date", { partyId: args.partyId, revision });
  const bills = await readFamilyBills(tx, await partyFamily(tx, args.partyId));
  if (bills.some(billOwes)) throw new AppError("party.bill_outstanding", { partyId: args.partyId });
  await requirePartyClosingEdits(tx, args.partyId, args.operatorId, args.expectedEdits);
  const rows = await tx
    .select({
      line: workingOrderLines,
      billRevision: workingOrders.revision,
      partyId: workingOrders.partyId,
    })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(
      and(
        inArray(
          workingOrders.id,
          bills.filter((bill) => bill.status === "settled").map((bill) => bill.id),
        ),
        isNull(workingOrderLines.parentLineId),
      ),
    )
    .orderBy(workingOrders.id, workingOrderLines.lineNo);
  const cancelled = await readLineCancellations(
    tx,
    rows.map(({ line }) => line.id),
  );
  const dishes: UnservedDish[] = [];
  for (const { line, billRevision, partyId } of rows) {
    const quantity = serviceQuantities(
      line.quantity,
      line.servedQuantity,
      cancelled.get(line.id) ?? 0,
    ).remaining;
    if (quantity === 0) continue;
    dishes.push({
      billId: line.workingOrderId,
      billRevision,
      lineId: line.id,
      name: staffPresentationName(line),
      quantity: thousandthsToDecimal(quantity),
      context: await readCancellationContext(tx, partyId!, line.id),
    });
  }
  const refused = () => new AppError("party.unserved_dishes", { partyId: args.partyId, dishes });
  if (args.collect !== undefined) {
    const moved = await collectAtCounter(tx, cfg, args, args.collect, dishes, refused, attendance);
    return finishTable(
      tx,
      {
        ...args,
        expectedPartyRevision: await partyRevision(tx, args.partyId),
        expectedEdits: args.expectedEdits.filter((edit) => !moved.includes(edit.billId)),
      },
      attendance === undefined
        ? undefined
        : { recorder: attendance.recorder, locationId: cfg.locationId },
    );
  }
  const requested = args.cancellations ?? [];
  if (
    dishes.length !== requested.length ||
    new Set(requested.map((item) => item.lineId)).size !== requested.length
  )
    throw refused();
  for (const dish of dishes) {
    const item = requested.find((item) => item.lineId === dish.lineId);
    if (
      item === undefined ||
      item.quantity !== dish.quantity ||
      item.expectedBillRevision !== dish.billRevision ||
      !isDeepStrictEqual(orderedCancellationContext(item.expectedContext), dish.context)
    )
      throw refused();
  }
  const refundLinks: RefundLink[] = [];
  for (const dish of dishes) {
    const item = requested.find((item) => item.lineId === dish.lineId)!;
    if (
      dish.context.stage === "not_started" &&
      dish.context.components.some((component) => component.firedAt !== null) &&
      item.preparationStarted === undefined
    )
      throw invalid("preparationStarted");
    const [bill] = await tx.select().from(workingOrders).where(eq(workingOrders.id, dish.billId));
    const answer = await cancelItem(
      tx,
      cfg,
      args.partyId,
      dish.lineId,
      {
        ...item,
        expectedEdit: args.expectedEdits.find((edit) => edit.billId === dish.billId)!,
        expectedPartyRevision: await partyRevision(tx, args.partyId),
        expectedBillRevision: bill!.revision,
        outcome: "keep_charge",
        submissionId: createHash("sha256")
          .update(JSON.stringify([args.submissionId, dish.lineId]))
          .digest("hex"),
        approver: args.approver,
        refundApprovedBy: args.refundApprovedBy,
      },
      args.operatorId,
      attendance,
    );
    refundLinks.push(...(answer.refundLinks ?? []));
  }
  const closed = await finishTable(
    tx,
    { ...args, expectedPartyRevision: await partyRevision(tx, args.partyId) },
    attendance === undefined
      ? undefined
      : { recorder: attendance.recorder, locationId: cfg.locationId },
  );
  return refundLinks.length === 0 ? closed : { ...closed, refundLinks };
}

/**
 * Fire the held work of the named bills with kitchen work to come, then move each to the counter.
 * The request's bills, with their revisions, must be exactly the bills `dishes` lists. Answers the
 * bills moved.
 */
async function collectAtCounter(
  tx: Transaction,
  cfg: OriginConfig,
  args: FinishPartyArgs,
  collect: CounterCollection,
  dishes: UnservedDish[],
  refused: () => AppError,
  attendance?: OrderAttendance,
): Promise<string[]> {
  const listed = new Map(dishes.map((dish) => [dish.billId, dish.billRevision]));
  if (
    listed.size !== collect.bills.length ||
    collect.bills.some((bill) => listed.get(bill.billId) !== bill.expectedBillRevision)
  )
    throw refused();
  const moving = [
    ...new Set(
      dishes
        .filter((dish) => dish.context.components.some((component) => component.id !== null))
        .map((dish) => dish.billId),
    ),
  ].sort();
  if (moving.length === 0) throw invalid("collect");
  await releaseHeldWorkOf(tx, cfg, args.partyId, moving, args.operatorId, attendance);
  for (const billId of moving)
    await moveSettledBillToCounter(
      tx,
      cfg,
      billId,
      { partyId: args.partyId },
      args.expectedEdits.find((edit) => edit.billId === billId)!,
    );
  return moving;
}
