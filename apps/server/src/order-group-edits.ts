import "./errors.js";
import {
  type Transaction,
  orderGroups,
  workingOrderLines,
  workingOrders,
  ticketItems,
} from "@waitron/db";
import { AppError, stringToThousandths } from "@waitron/shared";
import { and, eq, ne, inArray, isNull, sql, or } from "drizzle-orm";
import {
  parseBillEditExpecteds,
  requireBillEditors,
  parseBillEditExpected,
  requireBillEditor,
} from "./bill-editing.js";
import { inIds } from "./kitchen-print.js";
import type { BillEditExpected } from "./order-drafts.js";
import {
  printedHeldGroups,
  heldItemsOf,
  type HeldChange,
  correctHoldTickets,
  recordJoiningStations,
  printHoldTickets,
} from "./order-group-hold-paper.js";
import {
  type PartyCommandArgs,
  recordGroupEvent,
  requireHeldGroup,
  readGroupNumberLabels,
  startGroup,
  removeEmptiedHeldGroups,
} from "./order-group-records.js";
import { runServiceCommand, checkAndBumpParty, requireBillOfParty } from "./parties.js";
import type { TradingContext } from "./trading-context.js";
import type { OrderAttendance } from "./working-order-context.js";
import {
  refusePaymentInFlight,
  bumpRevisionKeepingPayment,
  bumpRevision,
} from "./working-order-edit-state.js";
import { splitLinesWithinOrder, splitUnitsWithinOrder } from "./working-order-transfer.js";

/**
 * Put the party's held groups in this order. `heldGroupIds` names every held group once; they take
 * the positions the held groups already hold, so a fired group never moves.
 */
export async function reorderHeldGroups(
  tx: Transaction,
  partyId: string,
  heldGroupIds: string[],
  args: PartyCommandArgs,
  attendance?: OrderAttendance,
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    "group.reorder",
    { partyId, heldGroupIds, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      const groups = await tx
        .select({ id: orderGroups.id, state: orderGroups.state, position: orderGroups.position })
        .from(orderGroups)
        .where(and(eq(orderGroups.partyId, partyId), ne(orderGroups.state, "removed")));
      const byId = new Map(groups.map((group) => [group.id, group]));
      for (const id of heldGroupIds) {
        const group = byId.get(id);
        if (group === undefined) throw new AppError("group.not_found", { groupId: id });
        if (group.state !== "held") throw new AppError("group.not_held", { groupId: id });
      }
      const held = groups.filter((group) => group.state === "held");
      if (
        new Set(heldGroupIds).size !== heldGroupIds.length ||
        heldGroupIds.length !== held.length
      ) {
        throw new AppError("management.request_invalid", { field: "heldGroupIds" });
      }
      const positions = held.map((group) => group.position).sort((a, b) => a - b);
      for (const [i, id] of heldGroupIds.entries()) {
        if (byId.get(id)!.position !== positions[i]) {
          // A snooze belongs to the place in the sequence it was given at.
          await tx
            .update(orderGroups)
            .set({ position: positions[i]!, remindAt: null })
            .where(eq(orderGroups.id, id));
        }
      }
      await recordGroupEvent(
        tx,
        {
          partyId,
          groupId: null,
          kind: "group.reordered",
          actorId: args.operatorId,
          detail: { heldGroupIds },
        },
        attendance === undefined
          ? undefined
          : { recorder: attendance.recorder, at: attendance.clock.now().instant.toISOString() },
      );
      return { revision };
    },
  );
}
/**
 * Move dish lines, or part of one, from held groups into another held group or a new one at the end
 * of the sequence. A line stays on its bill; a part moved splits the row. A group the move empties
 * is removed. What moved prints `-N` for a group it left, and `+N` for one it joined, at the
 * stations that have that group's HOLD paper; a new group prints its own HOLD ticket at the stations
 * that print held work in advance ({@link printHoldTickets}).
 */
export async function moveLinesToGroup(
  tx: Transaction,
  cfg: TradingContext,
  partyId: string,
  moves: { lineId: string; quantity: string }[],
  target: { groupId: string } | "new",
  args: PartyCommandArgs & { expectedEdits: BillEditExpected[] },
  attendance?: OrderAttendance,
): Promise<{ revision: number }> {
  const expectedEdits = parseBillEditExpecteds(args.expectedEdits);
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    "group.move",
    { partyId, moves, target, operatorId: args.operatorId, expectedEdits },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      if (moves.length === 0 || new Set(moves.map((m) => m.lineId)).size !== moves.length) {
        throw new AppError("management.request_invalid", { field: "moves" });
      }
      if (target !== "new") await requireHeldGroup(tx, partyId, target.groupId);
      const lines = await tx
        .select({
          id: workingOrderLines.id,
          workingOrderId: workingOrderLines.workingOrderId,
          lineNo: workingOrderLines.lineNo,
          quantity: workingOrderLines.quantity,
          groupId: workingOrderLines.groupId,
          groupState: orderGroups.state,
          billStatus: workingOrders.status,
        })
        .from(workingOrderLines)
        .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
        .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
        .where(
          and(
            inArray(
              workingOrderLines.id,
              moves.map((m) => m.lineId),
            ),
            isNull(sql`+${workingOrderLines.parentLineId}`),
            eq(orderGroups.partyId, partyId),
            ne(orderGroups.state, "removed"),
          ),
        );
      // An extras line is not found on its own: it moves only with its dish.
      const lineById = new Map(lines.map((line) => [line.id, line]));
      for (const { lineId } of moves) {
        const line = lineById.get(lineId);
        if (line === undefined) throw new AppError("group.not_found", { lineId });
        if (line.groupState !== "held") {
          throw new AppError("group.not_held", { groupId: line.groupId! });
        }
        // This command can split quantities; only open bills may change their financial rows.
        if (line.billStatus !== "open") {
          throw new AppError("working_order.not_open", { workingOrderId: line.workingOrderId });
        }
      }
      const billIds = [...new Set(lines.map((line) => line.workingOrderId))];
      for (const billId of billIds) {
        await requireBillOfParty(tx, partyId, billId);
      }
      // A partial move splits the line, rewriting the rows that carry its price.
      const splitting = new Set(
        moves.flatMap(({ lineId, quantity }) => {
          const line = lineById.get(lineId)!;
          return isWholeLine(quantity, line.quantity) ? [] : [line.workingOrderId];
        }),
      );
      if (splitting.size > 0) await refusePaymentInFlight(tx, [...splitting]);
      await requireBillEditors(tx, billIds, args.operatorId, expectedEdits);
      const printed = await printedHeldGroups(tx, [
        ...lines.map((line) => line.groupId!),
        ...(target === "new" ? [] : [target.groupId]),
      ]);
      const numberLabels = await readGroupNumberLabels(tx, [partyId]);
      const heldItems = await heldItemsOf(
        tx,
        moves.map((m) => m.lineId),
      );
      const targetId =
        target === "new"
          ? await startGroup(tx, partyId, "hold", args.operatorId, "next_course")
          : target.groupId;
      const sources = new Set<string>();
      const splitsByBill = new Map<string, { lineNo: number; quantity: string }[]>();
      for (const { lineId, quantity } of moves) {
        const line = lineById.get(lineId)!;
        sources.add(line.groupId!);
        const splits = splitsByBill.get(line.workingOrderId) ?? [];
        splitsByBill.set(line.workingOrderId, splits);
        if (isWholeLine(quantity, line.quantity)) {
          await tx
            .update(workingOrderLines)
            .set({ groupId: targetId })
            .where(
              or(eq(workingOrderLines.id, lineId), eq(workingOrderLines.parentLineId, lineId)),
            );
        } else {
          splits.push({ lineNo: line.lineNo, quantity });
        }
      }
      const splitIds = new Map<string, string>();
      for (const [billId, splits] of splitsByBill) {
        if (splits.length === 0) continue;
        const split = await splitLinesWithinOrder(tx, cfg, billId, splits);
        await tx
          .update(workingOrderLines)
          .set({ groupId: targetId })
          .where(
            inArray(
              workingOrderLines.id,
              [...split.values()].map((row) => row.id),
            ),
          );
        for (const [from, to] of split) splitIds.set(from, to.id);
      }
      const taken: HeldChange[] = [];
      const given: (HeldChange & { groupId: string })[] = [];
      const movedTicketLines: string[] = [];
      for (const { lineId, quantity } of moves) {
        const line = lineById.get(lineId)!;
        const items = heldItems.get(lineId);
        if (items === undefined || line.groupId === targetId) continue;
        const split = splitIds.get(lineId);
        for (const item of items) {
          // A partial move has no split-off extras; a whole move uses each record's own line.
          const moved = split === undefined ? item.lineQuantity : stringToThousandths(quantity);
          const movedLineId = split ?? item.workingOrderLineId;
          movedTicketLines.push(movedLineId);
          const change = {
            workingOrderId: line.workingOrderId,
            stationId: item.stationId,
            quantity: moved,
          };
          const from = printed.get(line.groupId!);
          if (from !== undefined)
            taken.push({
              ...change,
              workingOrderLineId: item.workingOrderLineId,
              groupId: line.groupId!,
              group: from,
              numberPartyLabel: numberLabels.get(line.groupId!),
            });
          const to = printed.get(targetId);
          if (to !== undefined) {
            given.push({
              ...change,
              workingOrderLineId: movedLineId,
              groupId: targetId,
              group: to,
              numberPartyLabel: numberLabels.get(targetId),
            });
          }
        }
      }
      await correctHoldTickets(tx, cfg, taken, { kind: "HOLD CHANGED", direction: "removed" });
      if (movedTicketLines.length > 0)
        await tx
          .update(ticketItems)
          .set({ holdPaperQueued: false })
          .where(inIds(ticketItems.workingOrderLineId, movedTicketLines));
      await recordJoiningStations(tx, given);
      await correctHoldTickets(tx, cfg, given, { kind: "HOLD CHANGED", direction: "added" });
      if (target === "new") await printHoldTickets(tx, cfg, [targetId]);
      await bumpRevisionKeepingPayment(tx, [...splitsByBill.keys()]);
      const snapshot =
        attendance === undefined
          ? undefined
          : { recorder: attendance.recorder, at: attendance.clock.now().instant.toISOString() };
      await recordGroupEvent(
        tx,
        {
          partyId,
          groupId: targetId,
          kind: "group.lines_moved",
          actorId: args.operatorId,
          detail: { moves, from: [...sources] },
        },
        snapshot,
      );
      await removeEmptiedHeldGroups(tx, partyId, [...sources], args.operatorId, snapshot);
      return { revision };
    },
    cfg.madeHereSink,
  );
}

export async function splitHeldLineIntoUnits(
  tx: Transaction,
  cfg: TradingContext,
  partyId: string,
  lineId: string,
  args: PartyCommandArgs & { expectedEdit: BillEditExpected },
  attendance?: OrderAttendance,
): Promise<{ revision: number }> {
  const expectedEdit = parseBillEditExpected(args.expectedEdit);
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    "group.split_line",
    { partyId, lineId, operatorId: args.operatorId, expectedEdit },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      const [line] = await tx
        .select({
          workingOrderId: workingOrderLines.workingOrderId,
          lineNo: workingOrderLines.lineNo,
          groupId: workingOrderLines.groupId,
          groupState: orderGroups.state,
          billStatus: workingOrders.status,
        })
        .from(workingOrderLines)
        .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
        .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
        .where(
          and(
            eq(workingOrderLines.id, lineId),
            isNull(workingOrderLines.parentLineId),
            eq(orderGroups.partyId, partyId),
            ne(orderGroups.state, "removed"),
          ),
        );
      if (line === undefined) throw new AppError("group.not_found", { lineId });
      if (line.groupState !== "held")
        throw new AppError("group.not_held", { groupId: line.groupId! });
      if (line.billStatus !== "open")
        throw new AppError("working_order.not_open", { workingOrderId: line.workingOrderId });
      await requireBillOfParty(tx, partyId, line.workingOrderId);
      await refusePaymentInFlight(tx, [line.workingOrderId]);
      await requireBillEditor(tx, line.workingOrderId, args.operatorId, expectedEdit);
      await splitUnitsWithinOrder(tx, cfg, line.workingOrderId, line.lineNo);
      await bumpRevision(tx, [line.workingOrderId]);
      await recordGroupEvent(
        tx,
        {
          partyId,
          groupId: line.groupId!,
          kind: "group.lines_moved",
          actorId: args.operatorId,
          detail: { splitLineId: lineId },
        },
        attendance === undefined
          ? undefined
          : { recorder: attendance.recorder, at: attendance.clock.now().instant.toISOString() },
      );
      return { revision };
    },
    cfg.madeHereSink,
  );
}
/** Whether `quantity` is exactly the line's stored quantity; a malformed one is not. */
function isWholeLine(quantity: string, stored: number): boolean {
  try {
    return stringToThousandths(quantity) === stored;
  } catch {
    return false;
  }
}
