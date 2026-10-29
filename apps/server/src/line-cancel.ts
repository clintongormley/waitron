import { eq, inArray } from "drizzle-orm";
import {
  lineServiceCancellations,
  nowIso,
  orderGroups,
  sales,
  ticketItems,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import {
  AppError,
  cancelRefundShare,
  centsToDecimal,
  decimal,
  divideDecimal,
  MONEY_SCALE,
  multiplyDecimal,
  sumDecimals,
  thousandthsToDecimal,
} from "@waitron/shared";
import { persons, type PinAttempts } from "@waitron/identity";
import { findAdjustmentReason, policySnapshotOf, recordAdjustment } from "@waitron/adjustments";
import { staffPresentationName } from "@waitron/catalogue";
import type { CancellationContext } from "./line-cancel-context.js";
import { requireRowCancellationContext } from "./line-cancel-context.js";
import { cancellationRefundValue, rowRefundValue } from "./cancellation-refund-value.js";
import type { TradingContext } from "./trading-context.js";
import { applyAdjustment, reasonNameIn, type AdjustmentArgs } from "./adjustments-apply.js";
import { invalid } from "./bill-allocation.js";
import { refusePaidLines } from "./bill-payments.js";
import { captureKitchenActivity } from "./attendance-capture.js";
import { requireBillEditor, parseBillEditExpected } from "./bill-editing.js";
import type { BillEditExpected } from "./order-drafts.js";
import { refuseRecalledWrite } from "./draft-source.js";
import { dishKitchenItems } from "./dish-kitchen.js";
import { enqueueCorrectionSlips, enqueueHoldCorrections, isStarted } from "./kitchen-print.js";
import { bumpPartyRevision, partyRevision, runServiceCommand } from "./parties.js";
import {
  assertTabOpen,
  refusePaymentInFlight,
  removeFromLine,
  removePortions,
  quantityOfLine,
  bumpRevision,
  type OrderAttendance,
} from "./working-order.js";
import "./errors.js";

export interface CancelItemAsk {
  expectedEdit: BillEditExpected;
  quantity: string;
  outcome: "remove_charge" | "keep_charge";
  preparationStarted?: boolean;
  refundHandoff?: boolean;
  expectedPartyRevision: number;
  expectedBillRevision: number;
  expectedContext: CancellationContext;
  /** Every portion line of one till row, `lineId` among them (plan D31). */
  lineIds?: string[];
  submissionId: string;
  reasonId?: string;
  note?: string;
  approver?: AdjustmentArgs["approver"];
  /** The person whose PIN `authorize` checked for `sale.refund`, or null when no PIN was checked.
   * Recorded only when the refund handoff stands (ticked, on a settled bill); otherwise ignored. */
  refundApprovedBy?: string | null;
}

type Line = typeof workingOrderLines.$inferSelect;

export interface RefundLink {
  lineId: string;
  adjustmentId: string;
}

export type CancelItemAnswer = { revision: number; refundLinks?: RefundLink[] };

export async function cancelItem(
  tx: Transaction,
  cfg: TradingContext,
  partyId: string,
  lineId: string,
  ask: CancelItemAsk,
  operatorId: string,
  attendance?: OrderAttendance,
  policy: {
    venueLocale: string;
    attempts?: PinAttempts;
    completeAdjustment?: (billId: string) => Promise<void>;
  } = { venueLocale: cfg.locale },
): Promise<CancelItemAnswer> {
  if (ask.outcome !== "remove_charge" && ask.outcome !== "keep_charge") throw invalid("outcome");
  if (ask.preparationStarted !== undefined && typeof ask.preparationStarted !== "boolean")
    throw invalid("preparationStarted");
  if (
    ask.lineIds !== undefined &&
    (!Array.isArray(ask.lineIds) || ask.lineIds.some((id) => typeof id !== "string"))
  )
    throw invalid("lineIds");
  const expectedEdit = parseBillEditExpected(ask.expectedEdit);
  const expectedContext = {
    ...ask.expectedContext,
    components: [...ask.expectedContext.components].sort((a, b) => {
      const left = a.id ?? a.lineId;
      const right = b.id ?? b.lineId;
      return left < right ? -1 : left > right ? 1 : 0;
    }),
  };
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    ask.submissionId,
    "line.cancel-item",
    {
      partyId,
      lineId,
      lineIds: ask.lineIds,
      quantity: ask.quantity,
      outcome: ask.outcome,
      preparationStarted: ask.preparationStarted,
      refundHandoff: ask.refundHandoff,
      expectedContext,
      expectedEdit,
      operatorId,
      reasonId: ask.reasonId,
      note: ask.note,
      approverId: ask.approver?.personId,
    },
    async () => {
      const { context, dishIds } = await requireRowCancellationContext(
        tx,
        partyId,
        lineId,
        ask.expectedContext,
        ask.lineIds,
      );
      if (
        ask.preparationStarted === true &&
        !context.components.some((component) => component.firedAt !== null)
      )
        throw invalid("preparationStarted");
      const started = context.stage === "started" || ask.preparationStarted === true;
      const revision = await partyRevision(tx, partyId);
      if (revision !== ask.expectedPartyRevision)
        throw new AppError("party.out_of_date", { partyId, revision });
      const [line] = await tx
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, lineId));
      const [bill] = await tx
        .select()
        .from(workingOrders)
        .where(eq(workingOrders.id, line!.workingOrderId));
      if (bill!.revision !== ask.expectedBillRevision)
        throw new AppError("working_order.out_of_date", {
          workingOrderId: bill!.id,
          revision: bill!.revision,
        });
      await requireBillEditor(tx, bill!.id, operatorId, expectedEdit);
      const members = ask.lineIds === undefined ? null : dishIds;
      await refuseRecalledWrite(tx, inArray(workingOrderLines.id, dishIds));
      const dishes =
        members === null
          ? [line!]
          : await tx
              .select()
              .from(workingOrderLines)
              .where(inArray(workingOrderLines.id, members))
              .orderBy(workingOrderLines.lineNo);
      const priors = await tx
        .select()
        .from(lineServiceCancellations)
        .where(inArray(lineServiceCancellations.lineId, dishIds));
      const priorOf = (id: string) => priors.find((prior) => prior.lineId === id);
      const availableOf = (dish: Line) =>
        dish.quantity -
        (priorOf(dish.id)?.quantity ?? 0) -
        (bill!.status === "settled" ? dish.servedQuantity : 0);
      const available = dishes.reduce((total, dish) => total + availableOf(dish), 0);
      const refused = () =>
        new AppError("adjustment.quantity_invalid", {
          workingOrderId: bill!.id,
          lineNo: line!.lineNo,
          quantity: ask.quantity,
        });
      const removed = quantityOfLine(
        ask.quantity,
        { quantity: available, unitPrecision: line!.unitPrecision ?? 0 },
        refused,
      );
      if ((line!.unitPrecision ?? 0) > 0 && removed !== available) throw refused();
      // A row gives up its last whole portions still cancellable (plan D32).
      const active = dishes.filter((dish) => availableOf(dish) > 0);
      const taken =
        members === null
          ? [{ dish: line!, off: removed }]
          : active
              .slice(active.length - removed / 1000)
              .map((dish) => ({ dish, off: dish.quantity }));
      const takenIds = taken.map(({ dish }) => dish.id);
      if (ask.outcome === "keep_charge" && context.billStatus !== "settled" && !started)
        throw invalid("outcome");
      const groupIds = [...new Set(dishes.flatMap((dish) => dish.groupId ?? []))];
      const groups =
        groupIds.length === 0
          ? []
          : await tx.select().from(orderGroups).where(inArray(orderGroups.id, groupIds));
      const groupOf = (dish: Line) => groups.find((group) => group.id === dish.groupId);
      if (ask.outcome === "remove_charge") {
        if (!started) {
          await assertTabOpen(tx, bill!.id);
          await refusePaymentInFlight(tx, [bill!.id]);
          await refusePaidLines(
            tx,
            bill!.id,
            taken.map(({ dish, off }) => ({
              id: dish.id,
              lineNo: dish.lineNo,
              keeps: dish.quantity - off,
            })),
          );
          const tickets = await tx
            .select()
            .from(ticketItems)
            .where(inArray(ticketItems.workingOrderLineId, takenIds));
          const targetOf = (dish: Line) => {
            const ticket = tickets.find((item) => item.workingOrderLineId === dish.id);
            return {
              ...dish,
              ticketItemId: ticket?.id ?? null,
              firedAt: ticket?.firedAt ?? null,
              stationId: ticket?.stationId ?? null,
              state: ticket?.state ?? null,
              firedQuantity: ticket?.quantity ?? 0,
            };
          };
          const at =
            attendance === undefined
              ? undefined
              : {
                  recorder: attendance.recorder,
                  at: attendance.clock.now().instant.toISOString(),
                };
          if (members === null)
            await removeFromLine(
              tx,
              cfg,
              bill!.id,
              targetOf(line!),
              removed === line!.quantity ? null : removed,
              operatorId,
              at,
            );
          else
            await removePortions(
              tx,
              cfg,
              bill!.id,
              taken.map(({ dish }) => targetOf(dish)),
              operatorId,
              at,
            );
          await policy.completeAdjustment?.(bill!.id);
          return { revision: await partyRevision(tx, partyId) };
        }
        if (typeof ask.reasonId !== "string" || ask.reasonId.length === 0)
          throw invalid("reasonId");
        // The adjustment path already corrects printed HOLD work.
        const unprinted = taken.filter(({ dish }) => {
          const group = groupOf(dish);
          return group?.state === "held" && group.holdPrintedAt === null;
        });
        if (unprinted.length > 0) {
          const work = await dishKitchenItems(
            tx,
            unprinted.map(({ dish }) => dish.id),
          );
          await enqueueHoldCorrections(
            tx,
            cfg,
            bill!.id,
            unprinted.flatMap(({ dish, off }) =>
              (work.get(dish.id) ?? [])
                .filter((item) => item.firedAt === null)
                .map((item) => ({
                  workingOrderLineId: item.workingOrderLineId,
                  stationId: item.stationId,
                  group: groupOf(dish)!.displayNumber,
                  quantity: Number(
                    divideDecimal(
                      multiplyDecimal(decimal(String(item.lineQuantity)), decimal(String(off))),
                      decimal(String(dish.quantity)),
                      0,
                    ),
                  ),
                  wasStarted: isStarted(item.state),
                })),
            ),
            { kind: "HOLD CANCELLED" },
          );
        }
        await applyAdjustment(
          tx,
          cfg,
          {
            orderId: bill!.id,
            expectedEdit,
            expectedRevision: ask.expectedBillRevision,
            lineId,
            ...(members === null ? {} : { lineIds: members }),
            action: "cancel",
            quantity: ask.quantity,
            reasonId: ask.reasonId,
            note: ask.note ?? null,
            operatorId,
            submissionId: ask.submissionId,
            approver: ask.approver,
            preparationStarted: ask.preparationStarted,
            recordedPreparationStarted: true,
          },
          policy.venueLocale,
          policy.attempts,
          attendance,
        );
        await policy.completeAdjustment?.(bill!.id);
      } else {
        if (typeof ask.reasonId !== "string" || ask.reasonId.trim().length === 0)
          throw invalid("reasonId");
        const reason = await findAdjustmentReason(tx, ask.reasonId);
        if (reason.kind !== "void") throw new AppError("adjustment.action_not_allowed", {});
        if (reason.noteRequired && (ask.note ?? "").trim().length === 0)
          throw new AppError("adjustment.note_required", {});
        const [actor] = await tx
          .select({ locale: persons.locale })
          .from(persons)
          .where(eq(persons.id, operatorId));
        if (actor === undefined) throw new AppError("person.not_found", { personId: operatorId });
        const rows = await tx
          .select()
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, bill!.id));
        const work = await dishKitchenItems(tx, dishIds);
        const families = taken.map(({ dish, off }) => {
          const prior = priorOf(dish.id);
          const quantity = off + (prior?.quantity ?? 0);
          const shareOf = (row: Line, of: number) =>
            row.id === dish.id
              ? of
              : Number(
                  divideDecimal(
                    multiplyDecimal(decimal(String(row.quantity)), decimal(String(of))),
                    decimal(String(dish.quantity)),
                    0,
                  ),
                );
          return {
            dish,
            prior,
            quantity,
            family: rows
              .filter((row) => row.id === dish.id || row.parentLineId === dish.id)
              .map((row) => ({
                row,
                remaining: row.quantity - shareOf(row, quantity),
                covered: shareOf(row, off),
              })),
          };
        });
        const coveredValue = (list: boolean) =>
          sumDecimals(
            families.flatMap(({ family }) =>
              family.map(({ row, covered }) =>
                divideDecimal(
                  multiplyDecimal(
                    centsToDecimal(
                      list ? (row.listUnitPriceGross ?? row.unitPriceGross) : row.unitPriceGross,
                    ),
                    thousandthsToDecimal(covered),
                  ),
                  thousandthsToDecimal(row.priceQuantity),
                  MONEY_SCALE,
                ),
              ),
            ),
          );
        const amount = coveredValue(false);
        const refundHandoff = ask.refundHandoff === true && context.billStatus === "settled";
        let refundValue = null;
        if (refundHandoff) {
          const [sale] = await tx
            .select({ id: sales.id })
            .from(sales)
            .where(eq(sales.workingOrderId, bill!.id));
          if (sale === undefined)
            throw new AppError("working_order.not_found", { workingOrderId: bill!.id });
          if (members === null) {
            const value = await cancellationRefundValue(tx, bill!.id, sale.id, lineId);
            if (value !== undefined)
              refundValue = cancelRefundShare(
                value,
                context.components.find((row) => row.lineId === lineId)!.cancelledQuantity,
                ask.quantity,
              );
          } else {
            const value = await rowRefundValue(tx, bill!.id, sale.id, dishIds);
            if (value !== undefined)
              refundValue = cancelRefundShare(
                value,
                thousandthsToDecimal(
                  dishes.reduce((total, dish) => total + (priorOf(dish.id)?.quantity ?? 0), 0),
                ),
                ask.quantity,
              );
          }
        }
        const first = dishes[0]!;
        const memberWork = dishIds.flatMap((id) => work.get(id) ?? []);
        const adjustmentId = await recordAdjustment(tx, {
          workingOrderId: bill!.id,
          line: {
            id: first.id,
            name: staffPresentationName(first),
            quantity: thousandthsToDecimal(
              dishes.reduce((total, dish) => total + dish.quantity, 0),
            ),
            listUnitPriceGross: centsToDecimal(first.listUnitPriceGross ?? first.unitPriceGross),
            creditedTo: first.creditedTo,
            stage: dishes.some((dish) => dish.servedQuantity > 0)
              ? "served"
              : (
                    members === null
                      ? context.components.some((item) => item.firedAt !== null)
                      : memberWork.some((item) => item.firedAt !== null)
                  )
                ? "fired"
                : dishes.some((dish) => groupOf(dish)?.state === "held")
                  ? "held"
                  : "unsent",
          },
          quantity: thousandthsToDecimal(removed),
          reason: {
            id: reason.id,
            name: reasonNameIn(reason, actor.locale, policy.venueLocale),
            policy: policySnapshotOf(reason),
          },
          action: "cancel",
          percentBp: null,
          beforeAmount: amount,
          afterAmount: amount,
          reduction: decimal("0"),
          nominalValue: coveredValue(true),
          requestedBy: operatorId,
          approvedBy: refundHandoff ? (ask.refundApprovedBy ?? null) : null,
          note: ask.note ?? null,
          chargeKept: true,
          preparationStarted: started,
          refundHandoff,
          refundValue,
        });
        const corrections = families.flatMap(({ dish, family }) =>
          family.flatMap(({ row, remaining }) => {
            const item = (work.get(dish.id) ?? []).find(
              (item) => item.workingOrderLineId === row.id,
            );
            const corrected =
              item === undefined ? 0 : item.firedQuantity - Math.min(item.firedQuantity, remaining);
            return corrected === 0
              ? []
              : [
                  {
                    group: groupOf(dish),
                    item: {
                      workingOrderLineId: row.id,
                      stationId: item!.stationId,
                      quantity: corrected,
                      wasStarted: ask.preparationStarted === true || isStarted(item!.state),
                      fired: item!.firedAt !== null,
                    },
                  },
                ];
          }),
        );
        await enqueueCorrectionSlips(
          tx,
          cfg,
          bill!.id,
          corrections.filter(({ item }) => item.fired).map(({ item }) => item),
          "VOID",
        );
        if (groups.length > 0)
          await enqueueHoldCorrections(
            tx,
            cfg,
            bill!.id,
            corrections.flatMap(({ group, item }) =>
              item.fired || group === undefined
                ? []
                : [
                    {
                      ...item,
                      group: group.displayNumber,
                      ...(group.holdPrintedAt === null ? {} : { holdGroupId: group.id }),
                    },
                  ],
            ),
            { kind: "HOLD CANCELLED" },
          );
        for (const { family } of families) {
          for (const { row, remaining } of family) {
            const servedQuantity = Math.min(row.servedQuantity, remaining);
            const servedAt =
              servedQuantity > 0 && servedQuantity === remaining
                ? (row.servedAt ?? nowIso())
                : null;
            if (servedQuantity !== row.servedQuantity || servedAt !== row.servedAt)
              await tx
                .update(workingOrderLines)
                .set({ servedQuantity, servedAt })
                .where(eq(workingOrderLines.id, row.id));
            if (remaining === 0)
              await tx.delete(ticketItems).where(eq(ticketItems.workingOrderLineId, row.id));
            else
              await tx
                .update(ticketItems)
                .set({ quantity: remaining })
                .where(eq(ticketItems.workingOrderLineId, row.id));
          }
        }
        for (const { dish, prior, quantity } of families) {
          const values = {
            quantity,
            cancelledAt: nowIso(),
            wasStarted: prior?.wasStarted === true || started,
            actorId: operatorId,
          };
          await tx
            .insert(lineServiceCancellations)
            .values({ lineId: dish.id, ...values })
            .onConflictDoUpdate({ target: lineServiceCancellations.lineId, set: values });
        }
        await bumpRevision(tx, [bill!.id]);
        await bumpPartyRevision(tx, partyId);
        await captureKitchenActivity(
          tx,
          attendance,
          operatorId,
          [bill!.id],
          `party:${partyId}:${ask.submissionId}`,
        );
        if (refundHandoff)
          return {
            revision: await partyRevision(tx, partyId),
            refundLinks: [{ lineId: first.id, adjustmentId }],
          };
      }
      return { revision: await partyRevision(tx, partyId) };
    },
    cfg.madeHereSink,
  );
}
