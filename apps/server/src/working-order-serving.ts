import "./errors.js";
import {
  type Transaction,
  workingOrderLines,
  ticketItems,
  orderGroups,
  workingOrders,
  nowIso,
} from "@waitron/db";
import { assertQuantityPrecision, MAX_UNIT_PRECISION } from "@waitron/menu";
import { AppError, stringToThousandths } from "@waitron/shared";
import { type SQL, exists, sql, eq, and, isNull, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { captureKitchenActivity } from "./attendance-capture.js";
import { initiatedAt } from "./kitchen-phase.js";
import { readLineCancellations, serviceQuantities } from "./line-service-state.js";
import { onShownBill, type PartyCommandArgs, requireGroup } from "./order-groups.js";
import { partyFamily, runServiceCommand, checkAndBumpParty } from "./parties.js";
import type { TradingContext } from "./trading-context.js";
import type { OrderAttendance } from "./working-order-context.js";

/** A dish line on a bill of a party, as a served command reads it. */
interface ServableLine {
  id: string;
  workingOrderId: string;
  lineNo: number;
  quantity: number;
  activeQuantity: number;
  servedQuantity: number;
  unitPrecision: number | null;
  sentAt: string | null;
  groupState: "held" | "fired" | "removed" | null;
  ticketItemId: string | null;
  ticketFiredAt: string | null;
  ticketRequestedAt: string | null;
  ticketMadeHere: boolean | null;
  extraHeld: boolean;
}
/**
 * The dish lines `where` selects on the bills of the party and of every party merged into it that
 * Current orders shows ({@link onShownBill}), bill by bill in the order the bills were opened.
 */
async function servableLines(
  tx: Transaction,
  partyId: string,
  where: SQL,
): Promise<ServableLine[]> {
  const family = await partyFamily(tx, partyId);
  const extra = alias(workingOrderLines, "servable_extra");
  const extraItem = alias(ticketItems, "servable_extra_item");
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      workingOrderId: workingOrderLines.workingOrderId,
      lineNo: workingOrderLines.lineNo,
      quantity: workingOrderLines.quantity,
      servedQuantity: workingOrderLines.servedQuantity,
      unitPrecision: workingOrderLines.unitPrecision,
      sentAt: workingOrderLines.sentAt,
      groupState: orderGroups.state,
      ticketItemId: ticketItems.id,
      ticketFiredAt: ticketItems.firedAt,
      ticketRequestedAt: ticketItems.requestedAt,
      ticketMadeHere: ticketItems.madeHere,
      extraHeld: exists(
        tx
          .select({ one: sql`1` })
          .from(extra)
          .innerJoin(extraItem, eq(extraItem.workingOrderLineId, extra.id))
          .where(
            and(
              eq(extra.parentLineId, workingOrderLines.id),
              isNull(extraItem.firedAt),
              isNull(extraItem.requestedAt),
            ),
          ),
      ).mapWith(Boolean),
    })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      and(
        where,
        isNull(sql`+${workingOrderLines.parentLineId}`),
        inArray(workingOrders.partyId, family),
        onShownBill(),
      ),
    )
    .orderBy(
      workingOrders.openedAt,
      workingOrders.orderNumber,
      workingOrders.id,
      workingOrderLines.lineNo,
    );
  const cancellations = await readLineCancellations(
    tx,
    lines.map((line) => line.id),
  );
  return lines.map((line) => {
    const quantities = serviceQuantities(
      line.quantity,
      line.servedQuantity,
      cancellations.get(line.id) ?? 0,
    );
    return { ...line, activeQuantity: quantities.active, servedQuantity: quantities.served };
  });
}
/**
 * Whether a dish line is released work: the kitchen has it. A made-here line is released at its
 * send, even in a held group. Other held-group and unfired lines wait; an ungrouped line with no
 * kitchen item needs a sent time.
 */
export function isReleased(
  line: Pick<
    ServableLine,
    "groupState" | "ticketItemId" | "ticketFiredAt" | "ticketMadeHere" | "sentAt"
  >,
): boolean {
  if (line.ticketMadeHere === true) return true;
  return line.groupState === "held"
    ? false
    : line.ticketItemId !== null
      ? line.ticketFiredAt !== null
      : line.groupState !== null || line.sentAt !== null;
}
/** Whether the waiter has initiated a dish line, which is what serving needs (D21). The money
 *  gates read {@link isReleased} instead. */
export function serviceRequested(
  line: Pick<
    ServableLine,
    | "groupState"
    | "ticketItemId"
    | "ticketFiredAt"
    | "ticketRequestedAt"
    | "ticketMadeHere"
    | "sentAt"
  >,
): boolean {
  if (line.ticketMadeHere === true) return true;
  return line.groupState === "held"
    ? false
    : line.ticketItemId !== null
      ? initiatedAt({ requestedAt: line.ticketRequestedAt, firedAt: line.ticketFiredAt }) !== null
      : line.groupState !== null || line.sentAt !== null;
}
/** The dishes with an extra the kitchen has not been asked for. */
export function dishesWithHeldExtra(
  lines: readonly {
    parentLineId: string | null;
    ticketItemId: string | null;
    ticketRequestedAt: string | null;
    ticketFiredAt: string | null;
  }[],
): Set<string> {
  return new Set(
    lines.flatMap((line) =>
      line.parentLineId !== null &&
      line.ticketItemId !== null &&
      initiatedAt({ requestedAt: line.ticketRequestedAt, firedAt: line.ticketFiredAt }) === null
        ? [line.parentLineId]
        : [],
    ),
  );
}
type ReleasableDish = Parameters<typeof serviceRequested>[0] & {
  quantity: number;
  cancelledQuantity: number;
};
/** Whether Serve is offered: something of the dish is left, the waiter has asked for it
 *  ({@link serviceRequested}) and none of its extras is held. */
export function dishReleased(line: ReleasableDish, extraHeld: boolean): boolean {
  return line.quantity > line.cancelledQuantity && serviceRequested(line) && !extraHeld;
}
/** Something of the dish is left and its held group has still to release it. */
export function dishWaitsInHeldGroup(line: ReleasableDish, extraHeld: boolean): boolean {
  return (
    line.groupState === "held" &&
    line.quantity > line.cancelledQuantity &&
    !dishReleased(line, extraHeld)
  );
}
/**
 * The named orders holding a dish the kitchen is not making: one never sent and holding no kitchen
 * item ({@link unsentDishLines}), or one that is not released work ({@link isReleased}) — held in
 * a group, or held by its kitchen item.
 * A Requested dish served whole is not counted (D41).
 */
export async function ordersWithUnfiredDish(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      quantity: workingOrderLines.quantity,
      workingOrderId: workingOrderLines.workingOrderId,
      sentAt: workingOrderLines.sentAt,
      groupState: orderGroups.state,
      ticketItemId: ticketItems.id,
      ticketFiredAt: ticketItems.firedAt,
      ticketRequestedAt: ticketItems.requestedAt,
      ticketMadeHere: ticketItems.madeHere,
      servedQuantity: workingOrderLines.servedQuantity,
    })
    .from(workingOrderLines)
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      and(
        inArray(workingOrderLines.workingOrderId, [...orderIds]),
        isNull(sql`+${workingOrderLines.parentLineId}`),
      ),
    );
  const cancellations = await readLineCancellations(
    tx,
    lines.map((line) => line.id),
  );
  return new Set(
    lines
      .filter((line) => {
        const { active, remaining } = serviceQuantities(
          line.quantity,
          line.servedQuantity,
          cancellations.get(line.id) ?? 0,
        );
        if (active === 0) return false;
        if (line.sentAt === null && line.ticketItemId === null) return true;
        if (isReleased(line)) return false;
        return !(remaining === 0 && line.ticketRequestedAt !== null);
      })
      .map((line) => line.workingOrderId),
  );
}
/** Serving needs a dish the waiter has initiated ({@link serviceRequested}) and no held extra,
 *  else `group.line_held`. */
function refuseUnreleased(line: ServableLine): void {
  if (!serviceRequested(line) || line.extraHeld) {
    throw new AppError("group.line_held", { tabId: line.workingOrderId, lineNo: line.lineNo });
  }
}
/**
 * `quantity` as thousandths, refused `tab.serve_quantity_invalid` unless it is a positive decimal in
 * the line's unit's decimal places and no more than `limit`.
 */
function servedAmount(line: ServableLine, quantity: string, limit: number): number {
  const invalid = () =>
    new AppError("tab.serve_quantity_invalid", {
      tabId: line.workingOrderId,
      lineNo: line.lineNo,
      quantity,
    });
  let asked: number;
  try {
    assertQuantityPrecision(quantity, line.unitPrecision ?? MAX_UNIT_PRECISION, { positive: true });
    asked = stringToThousandths(quantity);
  } catch {
    throw invalid();
  }
  if (asked > limit) throw invalid();
  return asked;
}
/** Actual serving counts active food; billing quantities still determine the extras' proportions. */
async function writeServed(
  tx: Transaction,
  changes: readonly { line: ServableLine; served: number }[],
): Promise<void> {
  if (changes.length === 0) return;
  const at = nowIso();
  const children = await tx
    .select({
      id: workingOrderLines.id,
      parentLineId: workingOrderLines.parentLineId,
      quantity: workingOrderLines.quantity,
      servedQuantity: workingOrderLines.servedQuantity,
    })
    .from(workingOrderLines)
    .where(
      inArray(
        workingOrderLines.parentLineId,
        changes.map(({ line }) => line.id),
      ),
    );
  for (const { line, served } of changes) {
    const servedAt = served > 0 && served === line.activeQuantity ? at : null;
    await tx
      .update(workingOrderLines)
      .set({ servedQuantity: served, servedAt })
      .where(eq(workingOrderLines.id, line.id));
    for (const child of children.filter((row) => row.parentLineId === line.id)) {
      // A child's quantity is its dish's times the picks per dish, so this divides exactly.
      const childServed = Math.round((child.quantity * served) / line.quantity);
      await tx
        .update(workingOrderLines)
        .set({ servedQuantity: childServed, servedAt })
        .where(eq(workingOrderLines.id, child.id));
    }
  }
}
/**
 * Mark part or all of each named dish line of the party served. `quantity` is how much THIS command
 * serves, never more than is left to serve. Replayed by submission id before the party's revision is
 * compared (D8, D19).
 */
export async function markServed(
  tx: Transaction,
  cfg: TradingContext,
  partyId: string,
  items: { lineId: string; quantity: string }[],
  args: PartyCommandArgs,
  attendance?: OrderAttendance,
): Promise<{ revision: number }> {
  return changeServed(tx, cfg, partyId, items, args, "line.served", attendance);
}
/** Take back part or all of what was marked served on each named dish line, for a mis-tap. */
export async function unmarkServed(
  tx: Transaction,
  cfg: TradingContext,
  partyId: string,
  items: { lineId: string; quantity: string }[],
  args: PartyCommandArgs,
  attendance?: OrderAttendance,
): Promise<{ revision: number }> {
  return changeServed(tx, cfg, partyId, items, args, "line.unserved", attendance);
}

async function changeServed(
  tx: Transaction,
  cfg: TradingContext,
  partyId: string,
  items: { lineId: string; quantity: string }[],
  args: PartyCommandArgs,
  kind: "line.served" | "line.unserved",
  attendance?: OrderAttendance,
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    kind,
    { partyId, items, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      if (items.length === 0 || new Set(items.map((item) => item.lineId)).size !== items.length) {
        throw new AppError("management.request_invalid", { field: "items" });
      }
      const lines = new Map(
        (
          await servableLines(
            tx,
            partyId,
            inArray(
              workingOrderLines.id,
              items.map((item) => item.lineId),
            ),
          )
        ).map((line) => [line.id, line]),
      );
      const changes = items.map(({ lineId, quantity }) => {
        const line = lines.get(lineId);
        if (line === undefined) throw new AppError("group.not_found", { lineId });
        const serving = kind === "line.served";
        if (serving) refuseUnreleased(line);
        const amount = servedAmount(
          line,
          quantity,
          serving ? line.activeQuantity - line.servedQuantity : line.servedQuantity,
        );
        return { line, served: line.servedQuantity + (serving ? amount : -amount) };
      });
      await writeServed(tx, changes);
      await captureKitchenActivity(
        tx,
        attendance,
        args.operatorId,
        changes.map((change) => change.line.workingOrderId),
        `party:${partyId}:${args.submissionId}`,
      );
      return { revision };
    },
    cfg.madeHereSink,
  );
}
/**
 * Mark every dish line of a fired group fully served, on every bill of the party it sits on that
 * Current orders shows, a paid one included. A held group is refused `group.line_held`, naming its
 * first line.
 */
export async function markGroupServed(
  tx: Transaction,
  cfg: TradingContext,
  partyId: string,
  groupId: string,
  args: PartyCommandArgs,
  attendance?: OrderAttendance,
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    "group.served",
    { partyId, groupId, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      const state = await requireGroup(tx, partyId, groupId);
      const lines = await servableLines(tx, partyId, eq(workingOrderLines.groupId, groupId));
      // A held group left with no line is on its way to `removed`.
      if (state === "held" && lines.length === 0) {
        throw new AppError("group.not_found", { groupId });
      }
      lines.filter((line) => line.activeQuantity > 0).forEach(refuseUnreleased);
      const changes = lines
        .filter((line) => line.servedQuantity < line.activeQuantity)
        .map((line) => ({ line, served: line.activeQuantity }));
      await writeServed(tx, changes);
      await captureKitchenActivity(
        tx,
        attendance,
        args.operatorId,
        changes.map((change) => change.line.workingOrderId),
        `party:${partyId}:${args.submissionId}`,
      );
      return { revision };
    },
    cfg.madeHereSink,
  );
}
// Charged cancellations complete service without counting as food actually served.
export async function clampServed(tx: Transaction, lineIds: readonly string[]): Promise<void> {
  if (lineIds.length === 0) return;
  const rows = await tx
    .select({
      id: workingOrderLines.id,
      quantity: workingOrderLines.quantity,
      served: workingOrderLines.servedQuantity,
      servedAt: workingOrderLines.servedAt,
    })
    .from(workingOrderLines)
    .where(inArray(workingOrderLines.id, [...lineIds]));
  const cancellations = await readLineCancellations(tx, lineIds);
  for (const row of rows) {
    const { active, served } = serviceQuantities(
      row.quantity,
      row.served,
      cancellations.get(row.id) ?? 0,
    );
    const servedAt = served > 0 && served === active ? (row.servedAt ?? nowIso()) : null;
    if (served === row.served && servedAt === row.servedAt) continue;
    await tx
      .update(workingOrderLines)
      .set({ servedQuantity: served, servedAt })
      .where(eq(workingOrderLines.id, row.id));
  }
}
