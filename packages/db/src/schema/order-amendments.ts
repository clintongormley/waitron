import { sql } from "drizzle-orm";
import { check, foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumType, flag, id, label, newId, table, tsString } from "./columns.js";
import { nodes } from "./nodes.js";
import { workingOrders } from "./orders.js";
import { tills } from "./tenants.js";

/**
 * `order_placed` is the genesis entry, written when the order is placed; `order_cancelled` records
 * a placed order cancelled.
 */
export const orderAmendmentKind = enumType(["order_placed", "order_cancelled"]);

/**
 * The append-only, tamper-evident amendment log (art. 29.2.j LGT — the legal term lives only in
 * this comment; the table is English).
 *
 * Classified `state`, yet declared `appendOnly()` in `../classification.ts`: the update and delete
 * triggers that declaration installs are the whole of what keeps it immutable.
 *
 * Tamper-evidence is a per-order hash chain, `entry_hash = SHA-256(content ‖ prev_entry_hash)`
 * (`computeAmendmentHash`, ../order-amendment-hash.ts), ordered by the hashed `sequence_no`.
 */
export const orderAmendments = table(
  "order_amendments",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    workingOrderId: id("working_order_id").notNull(),
    // 1-based position within THIS order's amendment chain; contiguous and hashed.
    sequenceNo: count("sequence_no").notNull(),
    kind: orderAmendmentKind("kind").notNull(),
    // The accountable actor (the operator from the open session).
    actorId: id("actor_id").notNull(),
    // NULL on the genesis `order_placed`; required by the app for `order_cancelled`.
    reason: label("reason"),
    // Capture provenance — both hashed, so neither can be re-pointed undetected.
    capturedByTillId: id("captured_by_till_id").notNull(),
    capturedByNodeId: id("captured_by_node_id").notNull(),
    // Truncated to whole seconds so the hashed instant and the read-back agree.
    eventAt: tsString("event_at").notNull(),
    eventOffsetMinutes: count("event_offset_minutes").notNull(),
    entryHash: label("entry_hash").notNull(),
    prevEntryHash: label("prev_entry_hash"),
    isFirstEntry: flag("is_first_entry").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "order_amendments_order_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.capturedByTillId],
      foreignColumns: [tills.id],
      name: "order_amendments_till_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.capturedByNodeId],
      foreignColumns: [nodes.id],
      name: "order_amendments_node_fk",
    }).onDelete("restrict"),
    // THE backstop against two writers claiming one chain position.
    unique("order_amendments_chain_position_key").on(t.workingOrderId, t.sequenceNo),
    index("order_amendments_order_idx").on(t.workingOrderId),
    check("order_amendments_sequence_no_ck", sql`${t.sequenceNo} > 0`),
    check("order_amendments_kind_ck", enumCheck(t.kind)),
    // 64 uppercase hex characters (GLOB is case-sensitive, unlike LIKE). Weaker than it looks: a
    // 64-byte blob satisfies both terms, because `length()` counts a blob's bytes.
    check(
      "order_amendments_entry_hash_ck",
      sql`length(${t.entryHash}) = 64 and ${t.entryHash} not glob '*[^0-9A-F]*'`,
    ),
    check("order_amendments_event_offset_ck", sql`${t.eventOffsetMinutes} between -840 and 840`),
    // A whole-second UTC `toISOString()` form, the only thing saying the text is a timestamp at
    // all. It does NOT check calendar validity: `2026-02-31T10:00:00.000Z` is accepted.
    check(
      "order_amendments_event_at_second_ck",
      sql`${t.eventAt} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'`,
    ),
    check(
      "order_amendments_chaining_ck",
      sql`(${t.isFirstEntry} and ${t.prevEntryHash} is null)
          or (not ${t.isFirstEntry} and ${t.prevEntryHash} is not null)`,
    ),
  ],
);
