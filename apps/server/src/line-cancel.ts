import { eq } from "drizzle-orm";
import {
  lineServiceCancellations,
  nowIso,
  orderGroups,
  ticketItems,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { AppError, decimal, divideDecimal, multiplyDecimal } from "@waitron/shared";
import type { CancellationContext } from "./line-cancel-context.js";
import { requireCancellationContext } from "./line-cancel-context.js";
import type { TillConfig } from "./till-config.js";
import { applyAdjustment, type AdjustmentArgs } from "./adjustments-apply.js";
import { invalid } from "./bill-allocation.js";
import { captureKitchenActivity } from "./attendance-capture.js";
import { refuseRecalledWrite } from "./draft-source.js";
import { dishKitchenItems } from "./dish-kitchen.js";
import { enqueueCorrectionSlips, enqueueHoldCorrections, isStarted } from "./kitchen-print.js";
import { bumpPartyRevision, partyRevision, runServiceCommand } from "./parties.js";
import { quantityOfLine, bumpRevision, type OrderAttendance } from "./working-order.js";
import "./errors.js";

export interface CancelItemAsk {
  quantity: string;
  outcome: "remove_charge" | "keep_charge";
  expectedPartyRevision: number;
  expectedBillRevision: number;
  expectedContext: CancellationContext;
  submissionId: string;
  reasonId?: string;
  note?: string;
  approver?: AdjustmentArgs["approver"];
}

export async function cancelItem(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  lineId: string,
  ask: CancelItemAsk,
  operatorId: string,
  attendance?: OrderAttendance,
): Promise<{ revision: number }> {
  if (ask.outcome !== "remove_charge" && ask.outcome !== "keep_charge") throw invalid("outcome");
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
      quantity: ask.quantity,
      outcome: ask.outcome,
      expectedContext,
      operatorId,
      reasonId: ask.reasonId,
      note: ask.note,
      approverId: ask.approver?.personId,
    },
    async () => {
      const context = await requireCancellationContext(tx, partyId, lineId, ask.expectedContext);
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
      await refuseRecalledWrite(tx, eq(workingOrderLines.id, lineId));
      const [prior] = await tx
        .select()
        .from(lineServiceCancellations)
        .where(eq(lineServiceCancellations.lineId, lineId));
      const active = line!.quantity - (prior?.quantity ?? 0);
      const refused = () =>
        new AppError("adjustment.quantity_invalid", {
          workingOrderId: bill!.id,
          lineNo: line!.lineNo,
          quantity: ask.quantity,
        });
      const removed = quantityOfLine(
        ask.quantity,
        { quantity: active, unitPrecision: line!.unitPrecision ?? 0 },
        refused,
      );
      if ((line!.unitPrecision ?? 0) > 0 && removed !== active) throw refused();
      if (
        ask.outcome === "keep_charge" &&
        context.billStatus !== "settled" &&
        context.stage === "not_started"
      )
        throw invalid("outcome");
      if (ask.outcome === "remove_charge") {
        if (typeof ask.reasonId !== "string" || ask.reasonId.length === 0)
          throw invalid("reasonId");
        const [group] =
          line!.groupId === null
            ? []
            : await tx.select().from(orderGroups).where(eq(orderGroups.id, line!.groupId));
        // The adjustment path already corrects printed HOLD work.
        if (group?.state === "held" && group.holdPrintedAt === null) {
          const work = (await dishKitchenItems(tx, [lineId])).get(lineId) ?? [];
          await enqueueHoldCorrections(
            tx,
            cfg,
            bill!.id,
            work
              .filter((item) => item.firedAt === null)
              .map((item) => ({
                workingOrderLineId: item.workingOrderLineId,
                stationId: item.stationId,
                group: group.displayNumber,
                quantity: Number(
                  divideDecimal(
                    multiplyDecimal(decimal(String(item.lineQuantity)), decimal(String(removed))),
                    decimal(String(line!.quantity)),
                    0,
                  ),
                ),
                wasStarted: isStarted(item.state),
              })),
            { kind: "HOLD CANCELLED" },
          );
        }
        await applyAdjustment(
          tx,
          cfg,
          {
            orderId: bill!.id,
            expectedRevision: ask.expectedBillRevision,
            lineId,
            action: "cancel",
            quantity: ask.quantity,
            reasonId: ask.reasonId,
            note: ask.note ?? null,
            operatorId,
            submissionId: ask.submissionId,
            approver: ask.approver,
          },
          cfg.locale,
          undefined,
          attendance,
        );
      } else {
        const quantity = removed + (prior?.quantity ?? 0);
        const rows = await tx
          .select()
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, bill!.id));
        const work = (await dishKitchenItems(tx, [lineId])).get(lineId) ?? [];
        const [group] =
          line!.groupId === null
            ? []
            : await tx.select().from(orderGroups).where(eq(orderGroups.id, line!.groupId));
        const family = rows
          .filter((row) => row.id === lineId || row.parentLineId === lineId)
          .map((row) => {
            const cancelled =
              row.id === lineId
                ? quantity
                : Number(
                    divideDecimal(
                      multiplyDecimal(decimal(String(row.quantity)), decimal(String(quantity))),
                      decimal(String(line!.quantity)),
                      0,
                    ),
                  );
            return { row, remaining: row.quantity - cancelled };
          });
        const corrections = [];
        for (const { row, remaining } of family) {
          const item = work.find((item) => item.workingOrderLineId === row.id);
          if (item !== undefined) {
            const corrected = item.firedQuantity - Math.min(item.firedQuantity, remaining);
            if (corrected > 0)
              corrections.push({
                workingOrderLineId: row.id,
                stationId: item.stationId,
                quantity: corrected,
                wasStarted: isStarted(item.state),
                fired: item.firedAt !== null,
              });
          }
        }
        await enqueueCorrectionSlips(
          tx,
          cfg,
          bill!.id,
          corrections.filter((item) => item.fired),
          "VOID",
        );
        if (group !== undefined)
          await enqueueHoldCorrections(
            tx,
            cfg,
            bill!.id,
            corrections
              .filter((item) => !item.fired)
              .map((item) => ({ ...item, group: group.displayNumber })),
            { kind: "HOLD CANCELLED" },
          );
        for (const { row, remaining } of family) {
          const servedQuantity = Math.min(row.servedQuantity, remaining);
          const servedAt =
            servedQuantity > 0 && servedQuantity === remaining ? (row.servedAt ?? nowIso()) : null;
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
        await tx
          .insert(lineServiceCancellations)
          .values({
            lineId,
            quantity,
            cancelledAt: nowIso(),
            wasStarted: prior?.wasStarted === true || context.stage === "started",
            actorId: operatorId,
          })
          .onConflictDoUpdate({
            target: lineServiceCancellations.lineId,
            set: {
              quantity,
              cancelledAt: nowIso(),
              wasStarted: prior?.wasStarted === true || context.stage === "started",
              actorId: operatorId,
            },
          });
        await bumpRevision(tx, [bill!.id]);
        await bumpPartyRevision(tx, partyId);
        await captureKitchenActivity(
          tx,
          attendance,
          operatorId,
          [bill!.id],
          `party:${partyId}:${ask.submissionId}`,
        );
      }
      return { revision: await partyRevision(tx, partyId) };
    },
  );
}
