import { eq } from "drizzle-orm";
import { workingOrders, type Transaction } from "@waitron/db";
import { AppError, DININGS, type Dining } from "@waitron/shared";
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
