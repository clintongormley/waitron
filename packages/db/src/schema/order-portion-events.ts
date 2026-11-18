import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { enumCheck, enumType, id, json, newId, nowIso, table, tsString } from "./columns.js";

export const ORDER_PORTION_EVENT_KINDS = ["moved", "cancelled"] as const;
const portionEventKind = enumType(ORDER_PORTION_EVENT_KINDS);

/**
 * A portion moved to another order, or cancelled with its charge. The order ids are plain ids with
 * no key: a row nothing may change must not refuse a later delete of a working order. The actor is a
 * plain person id: no key yet.
 */
export const orderPortionEvents = table(
  "order_portion_events",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    // A cancellation deletes the dish line, and this event retains its identity.
    lineId: id("line_id").notNull(),
    detail: json<{ cohortId?: string; ordinal?: number }>("detail").notNull().default({}),
    kind: portionEventKind("kind").notNull(),
    fromOrderId: id("from_order_id").notNull(),
    toOrderId: id("to_order_id"),
    actorId: id("actor_id"),
    at: tsString("at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    check("order_portion_events_kind_ck", enumCheck(t.kind)),
    check(
      "order_portion_events_destination_ck",
      sql`(${t.kind} = 'moved' and ${t.toOrderId} is not null and ${t.toOrderId} <> ${t.fromOrderId}) or (${t.kind} = 'cancelled' and ${t.toOrderId} is null)`,
    ),
  ],
);
