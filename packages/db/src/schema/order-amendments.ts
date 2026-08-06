import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { nodes } from "./nodes.js";
import { workingOrders } from "./orders.js";
import { tills } from "./tenants.js";

/**
 * What an amendment records. The legal duty (art. 29.2.j LGT / the restaurant precuenta) is
 * UNCONFIRMED (advisor Q14), so this is minimal (design §4): 7c produces exactly two kinds —
 * `order_placed` (the genesis entry written when the order is placed = the log opens) and
 * `order_cancelled` (a placed order cancelled, itself a logged amendment). Finer line-level kinds
 * (added/removed/quantity/price) are added additively by the future correction slice, beside a
 * producer — a frozen order's lines cannot be rewritten in 7c (require_open_parent), so there is no
 * 7c producer for them (flagged interpretation, design §4).
 */
export const orderAmendmentKind = pgEnum("order_amendment_kind", [
  "order_placed",
  "order_cancelled",
]);

/**
 * The append-only, tamper-evident amendment log (art. 29.2.j LGT — the legal term lives only in
 * this comment; the table is English, design §4). IMMUTABLE like `sale_lines`/`time_entries`, NOT
 * the mutable `working_orders`: `REVOKE ALL` + `GRANT SELECT, INSERT` + reject_mutation + a
 * TRUNCATE-block (migration SQL). Tamper-evidence is a per-order huella-style hash of content plus
 * the predecessor's hash (Decision 2): `entry_hash = SHA-256(content ‖ prev_entry_hash)`, with the
 * reason, actor and capturing till/node all INSIDE the hash (#52), and precedence tie-breaking on
 * the hashed `sequence_no` (#52). Local wall-clock (`event_at` + `event_offset_minutes`,
 * whole-second-truncated) reprints in venue time (#52).
 */
export const orderAmendments = pgTable(
  "order_amendments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    workingOrderId: uuid("working_order_id").notNull(),
    // 1-based position within THIS order's amendment chain; ours and contiguous, hashed.
    sequenceNo: integer("sequence_no").notNull(),
    kind: orderAmendmentKind("kind").notNull(),
    // The accountable actor (the operator uuid from the open session) — hashed (#52). Plain uuid,
    // no FK (the sale_voids.voided_by / sales.operator_id shape).
    actorId: uuid("actor_id").notNull(),
    // The contestable reason (art. 29.2.j). NULL on the genesis `order_placed` (a placement has no
    // contest reason); required by the app for `order_cancelled`. Hashed as empty when null,
    // exactly as chain-hash.ts hashes a null correctionReason.
    reason: text("reason"),
    // Capture provenance — the capturing till and node, both hashed so neither can be re-pointed
    // undetected (the chain-hash.ts capturedByTillId precedent).
    capturedByTillId: uuid("captured_by_till_id").notNull(),
    capturedByNodeId: uuid("captured_by_node_id").notNull(),
    // The event instant + its wall offset (the sales.issued_at/issued_offset_minutes pattern),
    // truncated to whole seconds so the hashed instant and the read-back agree (time_entries
    // precedent).
    eventAt: timestamp("event_at", { withTimezone: true, mode: "string" }).notNull(),
    eventOffsetMinutes: integer("event_offset_minutes").notNull(),
    // The chain fields (computeAmendmentHash): this entry's hash, the predecessor's, the genesis flag.
    entryHash: text("entry_hash").notNull(),
    prevEntryHash: text("prev_entry_hash"),
    isFirstEntry: boolean("is_first_entry").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.workingOrderId],
      foreignColumns: [workingOrders.tenantId, workingOrders.id],
      name: "order_amendments_order_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.capturedByTillId],
      foreignColumns: [tills.tenantId, tills.id],
      name: "order_amendments_till_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.capturedByNodeId],
      foreignColumns: [nodes.tenantId, nodes.id],
      name: "order_amendments_node_fk",
    }).onDelete("restrict"),
    // THE backstop against two writers claiming one chain position (mirrors
    // time_entries_chain_position_uq / registros_tenant_node_secuencia_uq).
    unique("order_amendments_chain_position_key").on(t.tenantId, t.workingOrderId, t.sequenceNo),
    index("order_amendments_order_idx").on(t.tenantId, t.workingOrderId),
    check("order_amendments_sequence_no_ck", sql`${t.sequenceNo} > 0`),
    check("order_amendments_entry_hash_ck", sql`${t.entryHash} ~ '^[0-9A-F]{64}$'`),
    check("order_amendments_event_offset_ck", sql`${t.eventOffsetMinutes} between -840 and 840`),
    check(
      "order_amendments_event_at_second_ck",
      sql`date_trunc('second', ${t.eventAt}) = ${t.eventAt}`,
    ),
    // Exactly one chain shape (mirrors time_entries_chaining_ck): the genesis carries no
    // predecessor, every later entry carries one.
    check(
      "order_amendments_chaining_ck",
      sql`(${t.isFirstEntry} and ${t.prevEntryHash} is null)
          or (not ${t.isFirstEntry} and ${t.prevEntryHash} is not null)`,
    ),
  ],
).enableRLS();
