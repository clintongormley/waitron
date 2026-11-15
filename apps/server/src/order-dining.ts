import { eq, inArray } from "drizzle-orm";
import {
  orderDiningLocked,
  ordersDiningLocked,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { AppError, DININGS, type Dining } from "@waitron/shared";
import { requireOrderBillEditor, type OrderEditAuthority } from "./bill-editing.js";
import { VENUE_SERVICE } from "./modules.js";
import "./errors.js";

/** `dining` from a request body, or undefined when it is absent; an explicit null is refused. */
export function parseDining(value: unknown): Dining | undefined {
  if (value === undefined) return undefined;
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
 * Refuse `order.set_lunch_takeaway`, saying whether staff may still switch the order to eaten here:
 * its zone's department leaves the way to the till, the region charges takeaway VAT, and nothing is
 * sent or paid. An order not yet written has nothing sent or paid.
 */
export async function refuseTakeawaySetLunch(
  tx: Transaction,
  workingOrderId: string,
  zoneId: string | undefined,
): Promise<never> {
  throw new AppError("order.set_lunch_takeaway", {
    canSwitch:
      zoneId !== undefined &&
      (await orderDiningLocked(tx, workingOrderId)) === null &&
      (await takesEitherWay(tx, zoneId)),
  });
}

// `resolveOrderDining` accepts both requests only for a till-choice department in a region that
// charges takeaway VAT: either other case fixes one way and refuses the other.
async function takesEitherWay(tx: Transaction, zoneId: string): Promise<boolean> {
  for (const dining of DININGS) {
    try {
      await VENUE_SERVICE.resolveOrderDining(tx, zoneId, dining);
    } catch (error) {
      if (error instanceof AppError && error.code === "order.dining_fixed") return false;
      throw error;
    }
  }
  return true;
}

/**
 * Switch an open order between eaten here and takeaway at `revision`, moving its revision on. The
 * choice is the one the till's read offers ({@link readOrderDinings}): the order's own department,
 * not its zone's current one, must leave the way to the till, and nothing may be sent or paid. Lines
 * keep both their classes, so nothing else changes.
 */
export async function switchOrderDining(
  tx: Transaction,
  workingOrderId: string,
  dining: Dining,
  revision: number,
  authority: OrderEditAuthority,
): Promise<void> {
  const [order] = await tx
    .select({
      status: workingOrders.status,
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
  const switchable = await VENUE_SERVICE.findOrdersWithDiningChoice(tx, [workingOrderId]);
  if (!switchable.has(workingOrderId)) {
    throw new AppError("order.dining_fixed", { dining: order.dining });
  }
  const locked = await orderDiningLocked(tx, workingOrderId);
  if (locked !== null) throw new AppError("order.dining_locked", { reason: locked });
  if (dining === "takeaway") {
    const lines = await tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, workingOrderId));
    const lunches = await VENUE_SERVICE.readLunchLineIds(
      tx,
      lines.map((line) => line.id),
    );
    if (lunches.size > 0) throw new AppError("order.set_lunch_takeaway", { canSwitch: false });
  }
  await tx
    .update(workingOrders)
    .set({ dining, revision: revision + 1 })
    .where(eq(workingOrders.id, workingOrderId));
}
