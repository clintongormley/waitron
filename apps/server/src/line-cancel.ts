import type { TillSaleResult } from "./till-sale.js";
import { requireEconomicWrite, type TradingAdmission } from "./trading-admission.js";
import { eq, inArray } from "drizzle-orm";
import {
  lineServiceCancellations,
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
import type { CancellationContext, CancellationTarget } from "./line-cancel-context.js";
import { requireRowCancellationContext } from "./line-cancel-context.js";
import { cancellationRefundValue, rowRefundValue } from "./cancellation-refund-value.js";
import type { TradingContext } from "./trading-context.js";
import { applyAdjustment, reasonNameIn, type AdjustmentArgs } from "./adjustments-apply.js";
import { invalid } from "./bill-allocation.js";
import { refusePaidLines } from "./bill-payments.js";
import { captureKitchenActivity } from "./attendance-capture.js";
import { requireOrderBillEditor, parseBillEditExpected } from "./bill-editing.js";
import type { BillEditExpected } from "./order-drafts.js";
import { refuseRecalledWrite } from "./draft-source.js";
import { holdPaperFor } from "./order-groups.js";
import { dishKitchenItems } from "./dish-kitchen.js";
import { enqueueHoldCorrections, isStarted } from "./kitchen-print.js";
import { bumpPartyRevision, partyRevision, runServiceCommand } from "./parties.js";
import {
  assertTabOpen,
  refusePaymentInFlight,
  removeFromLine,
  removePortions,
  quantityOfLine,
  bumpRevision,
  readOrderRevision,
  type OrderAttendance,
} from "./working-order.js";
import {
  serviceCancellationFamilies,
  enqueueServiceCancellation,
  writeServiceCancellations,
} from "./line-service-cancel.js";
import "./errors.js";

export interface CancelItemAsk {
  expectedEdit: BillEditExpected | null;
  quantity: string;
  outcome: "remove_charge" | "keep_charge";
  preparationStarted?: boolean;
  refundHandoff?: boolean;
  expectedPartyRevision?: number;
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

export type CancelItemAnswer = {
  revision: number;
  refundLinks?: RefundLink[];
  invoice?: TillSaleResult;
};

export async function cancelItem(
  tx: Transaction,
  cfg: TradingContext,
  target: CancellationTarget,
  lineId: string,
  ask: CancelItemAsk & { admission: TradingAdmission },
  operatorId: string,
  attendance?: OrderAttendance,
  policy: {
    venueLocale: string;
    attempts?: PinAttempts;
    completeAdjustment?: (billId: string) => Promise<TillSaleResult | null | void>;
  } = { venueLocale: cfg.locale },
): Promise<CancelItemAnswer> {
  await requireEconomicWrite(tx, cfg, ask.admission);
  if (ask.outcome !== "remove_charge" && ask.outcome !== "keep_charge") throw invalid("outcome");
  if (ask.preparationStarted !== undefined && typeof ask.preparationStarted !== "boolean")
    throw invalid("preparationStarted");
  if (
    ask.lineIds !== undefined &&
    (!Array.isArray(ask.lineIds) || ask.lineIds.some((id) => typeof id !== "string"))
  )
    throw invalid("lineIds");
  const partyId = typeof target === "string" ? target : null;
  const expectedEdit = partyId === null ? null : parseBillEditExpected(ask.expectedEdit);
  const scope =
    typeof target === "string"
      ? { kind: "party" as const, partyId: target }
      : { kind: "bill" as const, workingOrderId: target.billId };
  const revisionOf = () =>
    scope.kind === "party"
      ? partyRevision(tx, scope.partyId)
      : readOrderRevision(tx, scope.workingOrderId);
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
    scope,
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
      let invoice: TillSaleResult | null | void = undefined;
      const { context, dishIds } = await requireRowCancellationContext(
        tx,
        target,
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
      const revision = await revisionOf();
      if (partyId !== null && revision !== ask.expectedPartyRevision)
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
      await requireOrderBillEditor(tx, bill!.id, { operatorId, expectedEdit });
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
          invoice = await policy.completeAdjustment?.(bill!.id);
          return { revision: await revisionOf(), ...(invoice ? { invoice } : {}) };
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
            admission: ask.admission,
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
            // Counter cancellation and its adjustment share the bill's command scope.
            submissionId: partyId === null ? `cancel:${ask.submissionId}` : ask.submissionId,
            approver: ask.approver,
            preparationStarted: ask.preparationStarted,
            recordedPreparationStarted: true,
          },
          policy.venueLocale,
          policy.attempts,
          attendance,
        );
        invoice = await policy.completeAdjustment?.(bill!.id);
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
        const families = serviceCancellationFamilies(rows, taken, priors);
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
        const corrections = (
          await enqueueServiceCancellation(
            tx,
            cfg,
            bill!.id,
            families,
            work,
            ask.preparationStarted === true,
          )
        ).map(({ dish, ...correction }) => ({ ...correction, group: groupOf(dish) }));
        if (groups.length > 0) {
          const holdPaper = await holdPaperFor(
            tx,
            corrections.flatMap(({ group, requested }) =>
              requested && group !== undefined ? [group.id] : [],
            ),
          );
          await enqueueHoldCorrections(
            tx,
            cfg,
            bill!.id,
            corrections.flatMap(({ group, requested, requestedAt, item }) =>
              item.fired ||
              group === undefined ||
              (requested &&
                holdPaper(group.id, {
                  stationId: item.stationId,
                  requestedAt,
                  firedAt: null,
                }) === undefined)
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
        }
        await writeServiceCancellations(tx, families, operatorId, started);
        await bumpRevision(tx, [bill!.id]);
        if (partyId !== null) await bumpPartyRevision(tx, partyId);
        await captureKitchenActivity(
          tx,
          attendance,
          operatorId,
          [bill!.id],
          `${partyId === null ? "bill" : "party"}:${partyId ?? bill!.id}:${ask.submissionId}`,
        );
        if (refundHandoff)
          return {
            revision: await revisionOf(),
            refundLinks: [{ lineId: first.id, adjustmentId }],
          };
      }
      return { revision: await revisionOf(), ...(invoice ? { invoice } : {}) };
    },
    cfg.madeHereSink,
  );
}
