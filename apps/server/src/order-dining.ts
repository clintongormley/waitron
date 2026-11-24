import { eq, inArray } from "drizzle-orm";
import {
  orderDiningLocked,
  ordersDiningLocked,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { AppError, DININGS, type Dining } from "@waitron/shared";
import { requireOrderBillEditor, type OrderEditAuthority } from "./bill-editing.js";
import { VENUE_SERVICE } from "./modules.js";
import { captureOrderEdit, type OrderAttendance } from "./working-order-context.js";
import { hasBillSetMenuLines } from "./set-menu-bill.js";
import "./errors.js";

/** `dining` from a request body; absent, null or unknown, `management.request_invalid` names it. */
export function requireDining(value: unknown): Dining {
  if (typeof value !== "string" || !(DININGS as readonly string[]).includes(value)) {
    throw new AppError("management.request_invalid", { field: "dining" });
  }
  return value as Dining;
}

/**
 * Refuse `working_order.out_of_date` when the till showed the order a way of selling it does not
 * have. An absent `requested` is not checked.
 */
export function refuseOtherDining(
  workingOrderId: string,
  order: { dining: Dining; revision: number },
  requested: Dining | undefined,
): void {
  if (requested === undefined || requested === order.dining) return;
  throw new AppError("working_order.out_of_date", { workingOrderId, revision: order.revision });
}

/** {@link refuseOtherDining} for an order read here; an order that does not exist is not checked. */
export async function requireOrderDining(
  tx: Transaction,
  workingOrderId: string,
  requested: Dining | undefined,
): Promise<void> {
  if (requested === undefined) return;
  const [order] = await tx
    .select({ dining: workingOrders.dining, revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  if (order !== undefined) refuseOtherDining(workingOrderId, order, requested);
}

/** Whether the till offers the switch: never, now, or no longer (something is sent or paid). */
export type DiningChoice = "none" | "open" | "locked";

/**
 * Each named order's own stored way of selling, whatever its department now says, and whether staff
 * may switch it; read at once. An order that does not exist is absent.
 */
export async function readOrderDinings(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<ReadonlyMap<string, { dining: Dining; diningChoice: DiningChoice }>> {
  if (workingOrderIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: workingOrders.id, dining: workingOrders.dining })
    .from(workingOrders)
    .where(inArray(workingOrders.id, [...workingOrderIds]));
  const switchable = await VENUE_SERVICE.findOrdersWithDiningChoice(tx, workingOrderIds);
  const locked = await ordersDiningLocked(tx, [...switchable]);
  return new Map(
    rows.map((row) => [
      row.id,
      {
        dining: row.dining,
        diningChoice: !switchable.has(row.id) ? "none" : locked.has(row.id) ? "locked" : "open",
      },
    ]),
  );
}

/** The way an existing order sells, as stored. */
export async function storedOrderDining(tx: Transaction, workingOrderId: string): Promise<Dining> {
  const [order] = await tx
    .select({ dining: workingOrders.dining })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  if (order === undefined) throw new AppError("working_order.not_found", { workingOrderId });
  return order.dining;
}

/**
 * Switch an open order between eaten here and takeaway at `revision`, moving its revision on. The
 * choice is the one the till's read offers ({@link readOrderDinings}): the order's own department,
 * not its zone's current one, must leave the way to the till, and nothing may be sent or paid. Lines
 * keep both their classes, so nothing else changes. A request for the way the order already has
 * changes nothing, not even the revision. Answers the order's revision after.
 */
export async function switchOrderDining(
  tx: Transaction,
  workingOrderId: string,
  dining: Dining,
  revision: number,
  authority: OrderEditAuthority,
  attendance?: OrderAttendance & { personId: string },
): Promise<number> {
  const [order] = await tx
    .select({
      status: workingOrders.status,
      partyId: workingOrders.partyId,
      serviceMode: workingOrders.serviceMode,
      revision: workingOrders.revision,
      dining: workingOrders.dining,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  if (order === undefined) throw new AppError("working_order.not_found", { workingOrderId });
  if (order.status !== "open" || order.revision !== revision) {
    throw new AppError("working_order.out_of_date", { workingOrderId, revision: order.revision });
  }
  await requireOrderBillEditor(tx, workingOrderId, authority);
  if (dining === order.dining) return revision;
  const switchable = await VENUE_SERVICE.findOrdersWithDiningChoice(tx, [workingOrderId]);
  if (!switchable.has(workingOrderId)) {
    throw new AppError("order.dining_fixed", { dining: order.dining });
  }
  if (
    dining === "eat_in" &&
    (order.partyId === null || order.serviceMode !== "table_tab") &&
    (await hasBillSetMenuLines(tx, workingOrderId))
  )
    throw new AppError("set_menu.not_seated", {});
  const locked = await orderDiningLocked(tx, workingOrderId);
  if (locked !== null) throw new AppError("order.dining_locked", { reason: locked });
  await tx
    .update(workingOrders)
    .set({ dining, revision: revision + 1 })
    .where(eq(workingOrders.id, workingOrderId));
  await captureOrderEdit(
    tx,
    attendance,
    workingOrderId,
    attendance?.personId,
    revision + 1,
    "dining",
  );
  return revision + 1;
}
