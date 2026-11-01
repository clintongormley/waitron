import { ticketItems } from "@waitron/db";
import { sql, type SQL } from "drizzle-orm";
import type { TicketState } from "./kitchen-print.js";

export type KitchenPhase = "held" | "requested" | "waiting" | "preparing" | "ready";

/** `fired_at` is read first, so a row fired before `requested_at` existed reads as released. */
export function kitchenPhase(item: {
  requestedAt: string | null;
  firedAt: string | null;
  state: TicketState;
}): KitchenPhase {
  if (item.firedAt !== null) return item.state === "queued" ? "waiting" : item.state;
  return item.requestedAt === null ? "held" : "requested";
}

/** When the waiter initiated the item: its request time, or its fire time on a row from before
 *  the column; null while held. */
export function initiatedAt(item: {
  requestedAt: string | null;
  firedAt: string | null;
}): string | null {
  return item.requestedAt ?? item.firedAt;
}

export function heldItem(): SQL {
  return sql`(${ticketItems.firedAt} is null and ${ticketItems.requestedAt} is null)`;
}

export function requestedItem(): SQL {
  return sql`(${ticketItems.firedAt} is null and ${ticketItems.requestedAt} is not null)`;
}

export function initiatedItem(): SQL {
  return sql`(${ticketItems.requestedAt} is not null or ${ticketItems.firedAt} is not null)`;
}
