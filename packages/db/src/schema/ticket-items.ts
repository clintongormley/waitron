import { index, pgEnum, unique } from "drizzle-orm/pg-core";
import { id, label, table, tsString } from "./columns.js";

/**
 * The per-line kitchen state (KDS-1, §2d). A NEW enum, NOT `order_prep`'s `prep_state`: ticket items
 * are KITCHEN states only — `queued → preparing → ready`. `order_prep`'s fourth value `collected`
 * (customer handover) moves to the ORDER level as `working_orders.collected_at`, removing #63's
 * conflation of "kitchen done" with "customer handed the order". `prep_state` is dropped with
 * `order_prep` (it had no other consumer), so there is no reused-enum-with-a-dead-value to carry.
 */
export const ticketState = pgEnum("ticket_state", ["queued", "preparing", "ready"]);

/**
 * A per-line, per-station kitchen TICKET ITEM (KDS-1) — the replacement for `order_prep`'s
 * one-row-per-order model. A fire point (placeOrder / sendToPrep / a tab's round-send, reworked in
 * later tasks) inserts one row per new working-order line, with the line's station RESOLVED and
 * SNAPSHOTTED here at fire time (from the order's venue-service route, or the legacy fallback for a
 * context-less order), so later routing changes never reroute food already sent. MUTABLE, node-scoped
 * and ephemeral, exactly as `order_prep` was: advances `queued → preparing → ready` independently of
 * the parent order's fiscal status (a settled Mode-P order still has its lines cooked). The one advance
 * gate is a KITCHEN one, not a fiscal one — KDS-2 holds an item (`fired_at` NULL) until its course fires.
 *
 * `node_id` mirrors `order_prep`'s node scoping (the queue is node-scoped). `working_order_id` is a
 * denormalised grouping key (the per-station display groups a station's items by order) and carries
 * NO FK of its own — the FK on `working_order_line_id` gives the real integrity, cascading a
 * cancelled/abandoned line's item away with the line (the analogue of `order_prep`'s order FK).
 * `UNIQUE (working_order_line_id)` is one ticket item per line — also the guard that makes a
 * concurrent double-fire collide rather than duplicate.
 */
export const ticketItems = table(
  "ticket_items",
  {
    id: id("id").primaryKey().defaultRandom(),
    // The node the prep happens on — node-scoped, as order_prep was. Bare column: the
    // (node_id) → nodes(id) FK is hand-written in the --custom migration.
    nodeId: id("node_id").notNull(),
    // Denormalised grouping key — the per-station display groups a station's items by order. No FK: the
    // working_order_line_id FK below carries the integrity; this is a read convenience, snapshotted at fire.
    workingOrderId: id("working_order_id").notNull(),
    // The line this ticket item was fired from. Bare column: the (
    // working_order_line_id) → working_order_lines(id) FK is hand-written CASCADE in the
    // --custom migration, so a cancelled/abandoned line's item is removed with the line.
    workingOrderLineId: id("working_order_line_id").notNull(),
    // The station this line was ROUTED to, snapshotted at fire time (§2b) — re-pointing the product's
    // station later never moves an already-fired item. Bare column: the (
    // station_id) → kitchen_stations(id) FK is hand-written in the --custom migration.
    stationId: id("station_id").notNull(),
    state: ticketState("state").notNull().default("queued"),
    queuedAt: tsString("queued_at").notNull().defaultNow(),
    preparingAt: tsString("preparing_at"),
    readyAt: tsString("ready_at"),
    // The kitchen COURSE this item was fired to (KDS-2, §2b), SNAPSHOTTED from the line at fire time
    // (like `station_id` above) — re-pointing the product's course later never moves an already-fired
    // item. Bare NULLABLE uuid: the (course_id) → kitchen_courses(
    // id) FK is hand-written in the --custom migration. NULL = no course (fires earliest, spec §2b).
    courseId: id("course_id"),
    // HELD vs FIRED (KDS-2, §2b). NULL = HELD: the item shows greyed on the station display and
    // CANNOT advance (`queued → preparing → ready` is gated on `fired_at IS NOT NULL`, §3c). Set =
    // FIRED (workable). The first course of an order auto-fires at fire time (`now()`); later courses
    // are held until `fireCourse` stamps them.
    firedAt: tsString("fired_at"),
    awayAt: tsString("away_at"),
    note: label("note"),
  },
  (t) => [
    // One ticket item per line — also the guard that makes a concurrent double-fire collide (23505)
    // rather than silently duplicate the item.
    unique("ticket_items_working_order_line_id_key").on(t.workingOrderLineId),
    // The per-station queue scan (the analogue of order_prep_queue_idx, re-keyed on station).
    index("ticket_items_queue_idx").on(t.stationId, t.state),
  ],
);
