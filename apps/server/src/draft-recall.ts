import { and, eq, inArray } from "drizzle-orm";
import {
  orderDraftRecalledLines,
  orderGroups,
  ticketItems,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { AppError } from "@waitron/shared";
import { captureKitchenActivity } from "./attendance-capture.js";
import { invalid } from "./bill-allocation.js";
import { dishKitchenItems } from "./dish-kitchen.js";
import { enqueueCorrectionSlips, enqueueHoldCorrections, isStarted } from "./kitchen-print.js";
import { VENUE_SERVICE } from "./modules.js";
import { appendRecalledLine, type Draft } from "./order-drafts.js";
import type { PartyCommandArgs } from "./order-groups.js";
import { checkAndBumpParty, requireBillOfParty, runServiceCommand } from "./parties.js";
import type { TillConfig } from "./till-config.js";
import { bumpRevision, refusePaymentInFlight, type OrderAttendance } from "./working-order.js";
import "./errors.js";

export async function recallToDraft(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  lineId: string,
  args: PartyCommandArgs,
  attendance?: OrderAttendance,
): Promise<{ revision: number; draft: Draft }> {
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    "line.recall-draft",
    { partyId, lineId, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      const [line] = await tx
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, lineId));
      if (line === undefined) throw new AppError("group.not_found", { lineId });
      await requireBillOfParty(tx, partyId, line.workingOrderId);
      await refusePaymentInFlight(tx, [line.workingOrderId]);
      if (line.parentLineId !== null) throw invalid("lineId");
      if (!(await VENUE_SERVICE.readEditSentLines(tx)))
        throw new AppError("ticket.already_fired", { workingOrderId: line.workingOrderId });
      const items = (await dishKitchenItems(tx, [lineId])).get(lineId) ?? [];
      const started = items.find((item) => isStarted(item.state));
      if (started !== undefined)
        throw new AppError("ticket.already_started", {
          ticketItemId: started.ticketItemId,
        });
      if (line.servedQuantity > 0) throw invalid("lineId");
      const [reserved] = await tx
        .select({ id: orderDraftRecalledLines.id })
        .from(orderDraftRecalledLines)
        .where(eq(orderDraftRecalledLines.sourceLineId, lineId));
      if (reserved !== undefined) throw invalid("lineId");
      const [group] =
        line.groupId === null
          ? []
          : await tx
              .select()
              .from(orderGroups)
              .where(and(eq(orderGroups.id, line.groupId), eq(orderGroups.partyId, partyId)));
      if (group === undefined && line.sentAt === null && items.length === 0)
        throw new AppError("ticket.not_sent", { workingOrderId: line.workingOrderId, lineId });
      const fired = items
        .filter((item) => item.firedAt !== null)
        .map((item) => ({
          workingOrderLineId: item.workingOrderLineId,
          stationId: item.stationId,
          quantity: item.firedQuantity,
          wasStarted: false,
        }));
      await enqueueCorrectionSlips(tx, cfg, line.workingOrderId, fired, "RECALLED");
      if (group?.state === "held" && group.holdPrintedAt !== null)
        await enqueueHoldCorrections(
          tx,
          cfg,
          line.workingOrderId,
          items
            .filter((item) => item.firedAt === null)
            .map((item) => ({
              workingOrderLineId: item.workingOrderLineId,
              stationId: item.stationId,
              quantity: item.firedQuantity,
              wasStarted: false,
              group: group.displayNumber,
            })),
          { kind: "HOLD CANCELLED" },
        );
      if (items.length > 0)
        await tx.delete(ticketItems).where(
          inArray(
            ticketItems.id,
            items.map((item) => item.ticketItemId),
          ),
        );
      const draft = await appendRecalledLine(
        tx,
        cfg,
        partyId,
        line.workingOrderId,
        args.operatorId,
        lineId,
        group?.state === "held" ? group.id : null,
        attendance,
      );
      await bumpRevision(tx, [line.workingOrderId]);
      await captureKitchenActivity(
        tx,
        attendance,
        args.operatorId,
        [line.workingOrderId],
        args.submissionId,
      );
      return { revision, draft };
    },
  );
}
