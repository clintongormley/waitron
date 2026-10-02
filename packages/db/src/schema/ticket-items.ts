import { check, index, unique } from "drizzle-orm/sqlite-core";
import {
  enumCheck,
  enumType,
  flag,
  id,
  label,
  newId,
  nowIso,
  quantity,
  table,
  tsString,
} from "./columns.js";
import { kitchenCourses } from "./kitchen-courses.js";
import { kitchenStations } from "./kitchen-stations.js";
import { nodes } from "./nodes.js";
import { workingOrderLines } from "./orders.js";

/**
 * KITCHEN states only. Customer handover is an ORDER-level fact, `working_orders.collected_at`, so
 * "kitchen done" is never conflated with "customer handed the order".
 */
export const ticketState = enumType(["queued", "preparing", "ready"]);

/**
 * A per-line, per-station kitchen TICKET ITEM, recorded when a line is sent, with its
 * station SNAPSHOTTED so later routing changes never reroute food already sent. MUTABLE: it advances
 * independently of the parent order's fiscal status (a settled order still has its lines cooked).
 * A `made_here` item was made on the spot at the sending device (design §5.11): it is never printed,
 * is left out of kitchen and expo screens, floor kitchen counts, and the overdue report, and is
 * fired and `ready` from the moment it is recorded: it is never held.
 */
export const ticketItems = table(
  "ticket_items",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    // The node the prep happens on.
    nodeId: id("node_id")
      .notNull()
      /* v8 ignore start */
      .references(() => nodes.id),
    /* v8 ignore stop */
    // Denormalised grouping key for the per-station display. No FK: the working_order_line_id FK
    // below carries the integrity.
    workingOrderId: id("working_order_id").notNull(),
    workingOrderLineId: id("working_order_line_id")
      .notNull()
      /* v8 ignore start */
      .references(() => workingOrderLines.id, { onDelete: "cascade" }),
    /* v8 ignore stop */
    stationId: id("station_id")
      .notNull()
      /* v8 ignore start */
      .references(() => kitchenStations.id),
    /* v8 ignore stop */
    state: ticketState("state").notNull().default("queued"),
    queuedAt: tsString("queued_at").notNull().$defaultFn(nowIso),
    preparingAt: tsString("preparing_at"),
    readyAt: tsString("ready_at"),
    // NULL = no course (fires earliest).
    /* v8 ignore start */
    courseId: id("course_id").references(() => kitchenCourses.id),
    /* v8 ignore stop */
    // NULL = HELD: the item cannot advance until it is fired.
    firedAt: tsString("fired_at"),
    awayAt: tsString("away_at"),
    // Set when a waiter moved this record to its station by hand; a release keeps it there while the station is switched on.
    stationChosenAt: tsString("station_chosen_at"),
    note: label("note"),
    // The quantity fired. Null where an insert does not state it, and on every row older than
    // `0014_order_edit_columns.sql`.
    quantity: quantity("quantity"),
    madeHere: flag("made_here").notNull().default(false),
  },
  (t) => [
    // One ticket item per line — also the guard that makes a concurrent double-fire collide rather
    // than silently duplicate the item.
    unique("ticket_items_working_order_line_id_key").on(t.workingOrderLineId),
    index("ticket_items_queue_idx").on(t.stationId, t.state),
    index("ticket_items_order_idx").on(t.workingOrderId),
    index("ticket_items_waiting_idx").on(t.stationId, t.state, t.firedAt),
    check("ticket_items_state_ck", enumCheck(t.state)),
  ],
);
