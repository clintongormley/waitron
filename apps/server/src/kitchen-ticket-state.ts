import { ticketState, ticketItems, workingOrderLines, workingOrders } from "@waitron/db";
import { sql, type SQL, gt, and, eq, ne, isNull, or } from "drizzle-orm";

/** `queued → preparing → ready`. */
export type TicketState = (typeof ticketState.enumValues)[number];
/** Whether the cook has started an item. */
export function isStarted(state: TicketState | null): boolean {
  return state === "preparing" || state === "ready";
}
/**
 * What the kitchen was asked to make: the ticket item's fired quantity. A ticket item with none
 * reads its line's current quantity instead. For a
 * query joining `ticket_items` to its `working_order_lines` row.
 */
export const firedQuantity = sql<number>`coalesce(${ticketItems.quantity}, ${workingOrderLines.quantity})`;
/**
 * Whether part of a ticket item's fired quantity is still to be served. Ticket quantities already
 * exclude service cancellations, so serving consumes only that active work. For a query joining
 * `ticket_items` to its `working_order_lines` row.
 */
export function leftToServe(): SQL {
  return gt(firedQuantity, workingOrderLines.servedQuantity);
}
/**
 * A ticket item still the kitchen's work, whatever its party. For a query joining `ticket_items` to
 * its `working_order_lines` and `working_orders` rows.
 */
export function kitchenWork(): SQL | undefined {
  return and(
    eq(ticketItems.madeHere, false),
    ne(workingOrders.status, "abandoned"),
    isNull(workingOrders.collectedAt),
    leftToServe(),
  );
}

export function liveKitchenDish(): SQL | undefined {
  return and(
    kitchenWork(),
    or(
      isNull(workingOrders.partyId),
      sql`exists (
        with recursive service_family(id, state, next) as (
          select id, state, merged_into_party_id from parties where id = ${workingOrders.partyId}
          union
          select p.id, p.state, p.merged_into_party_id
          from parties p join service_family f on p.id = f.next
        )
        select 1 from service_family where state = 'open'
      )`,
    ),
  );
}
