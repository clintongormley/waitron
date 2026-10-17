import { isDeepStrictEqual } from "node:util";
import { and, eq, or } from "drizzle-orm";
import { ticketItems, workingOrderLines, workingOrders, type Transaction } from "@waitron/db";
import { AppError, thousandthsToDecimal } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import { isStarted, type TicketState } from "./kitchen-print.js";
import { readLineCancellations } from "./line-service-state.js";
import "./errors.js";

export interface CancellationContext {
  billStatus: typeof workingOrders.$inferSelect.status;
  stage: "not_started" | "started";
  components: {
    id: string | null;
    lineId: string;
    state: TicketState | null;
    firedAt: string | null;
    quantity: string;
    kitchenQuantity: string | null;
    servedQuantity: string;
    cancelledQuantity: string;
  }[];
}

function ordered(context: CancellationContext): CancellationContext {
  return {
    ...context,
    components: [...context.components].sort((a, b) => {
      const left = a.id ?? a.lineId;
      const right = b.id ?? b.lineId;
      return left < right ? -1 : left > right ? 1 : 0;
    }),
  };
}

export async function readCancellationContext(
  tx: Transaction,
  partyId: string,
  lineId: string,
): Promise<CancellationContext> {
  const [subject] = await tx
    .select({ parentId: workingOrderLines.parentLineId, bill: workingOrders })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(eq(workingOrderLines.id, lineId));
  if (subject === undefined || subject.parentId !== null) throw invalid("lineId");
  if (subject.bill.partyId !== partyId)
    throw new AppError("bill.other_party", { workingOrderId: subject.bill.id });
  if (subject.bill.status === "abandoned")
    throw new AppError("tab.not_open", { tabId: subject.bill.id });
  const family = await tx
    .select({
      lineId: workingOrderLines.id,
      quantity: workingOrderLines.quantity,
      servedQuantity: workingOrderLines.servedQuantity,
      id: ticketItems.id,
      state: ticketItems.state,
      firedAt: ticketItems.firedAt,
      kitchenQuantity: ticketItems.quantity,
    })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      and(
        eq(workingOrderLines.workingOrderId, subject.bill.id),
        or(eq(workingOrderLines.id, lineId), eq(workingOrderLines.parentLineId, lineId)),
      ),
    );
  const cancellations = await readLineCancellations(
    tx,
    family.map((line) => line.lineId),
  );
  return ordered({
    billStatus: subject.bill.status,
    stage: family.some((line) => isStarted(line.state) || line.servedQuantity > 0)
      ? "started"
      : "not_started",
    components: family.map((line) => ({
      id: line.id,
      lineId: line.lineId,
      state: line.state,
      firedAt: line.firedAt,
      quantity: thousandthsToDecimal(line.quantity),
      kitchenQuantity:
        line.id === null ? null : thousandthsToDecimal(line.kitchenQuantity ?? line.quantity),
      servedQuantity: thousandthsToDecimal(line.servedQuantity),
      cancelledQuantity: thousandthsToDecimal(cancellations.get(line.lineId) ?? 0),
    })),
  });
}

export async function requireCancellationContext(
  tx: Transaction,
  partyId: string,
  lineId: string,
  expected: CancellationContext,
): Promise<CancellationContext> {
  // Kitchen transitions need not advance a bill or party revision.
  const context = await readCancellationContext(tx, partyId, lineId);
  if (!isDeepStrictEqual(ordered(expected), context))
    throw new AppError("tab.cancel_context_changed", { context });
  return context;
}
