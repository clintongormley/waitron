import { sql } from "drizzle-orm";
import { check, foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumType, flag, id, label, newId, table, tsString } from "./columns.js";
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
export const orderAmendmentKind = enumType(["order_placed", "order_cancelled"]);

/**
 * The append-only, tamper-evident amendment log (art. 29.2.j LGT — the legal term lives only in
 * this comment; the table is English, design §4). IMMUTABLE like `sale_lines`/`time_entries`, NOT
 * the mutable `working_orders`.
 *
 * **What holds that immutability today is two triggers and nothing else.** The table is named in
 * the core set's append-only list (`../classification.ts`), from which `@waitron/store` installs
 * `order_amendments_append_only_update` and `order_amendments_append_only_delete`; each refuses
 * with `order_amendments is append-only`, result code 1811 (measured 2026-09-23 on Node v26.7.0
 * against the core migration set). The other two halves of the PostgreSQL arrangement are gone
 * rather than replaced: there are no roles and no grants on this engine, so the `REVOKE ALL` +
 * `GRANT SELECT, INSERT` pair has no counterpart, and SQLite has no TRUNCATE statement to block
 * (`truncate table order_amendments` is refused at parse time, `near "truncate": syntax error`).
 *
 * Tamper-evidence is a per-order fiscal-fingerprint-style hash of content plus
 * the predecessor's hash (Decision 2): `entry_hash = SHA-256(content ‖ prev_entry_hash)`, with the
 * reason, actor and capturing till/node all INSIDE the hash (#52), and precedence tie-breaking on
 * the hashed `sequence_no` (#52). Local wall-clock (`event_at` + `event_offset_minutes`,
 * whole-second-truncated) reprints in venue time (#52).
 */
export const orderAmendments = table(
  "order_amendments",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    workingOrderId: id("working_order_id").notNull(),
    // 1-based position within THIS order's amendment chain; ours and contiguous, hashed.
    sequenceNo: count("sequence_no").notNull(),
    kind: orderAmendmentKind("kind").notNull(),
    // The accountable actor (the operator uuid from the open session) — hashed (#52). Plain uuid,
    // no FK (the sale_voids.voided_by / sales.operator_id shape).
    actorId: id("actor_id").notNull(),
    // The contestable reason (art. 29.2.j). NULL on the genesis `order_placed` (a placement has no
    // contest reason); required by the app for `order_cancelled`. Hashed as empty when null,
    // exactly as chain-hash.ts hashes a null correctionReason.
    reason: label("reason"),
    // Capture provenance — the capturing till and node, both hashed so neither can be re-pointed
    // undetected (the chain-hash.ts capturedByTillId precedent).
    capturedByTillId: id("captured_by_till_id").notNull(),
    capturedByNodeId: id("captured_by_node_id").notNull(),
    // The event instant + its wall offset (the sales.issued_at/issued_offset_minutes pattern),
    // truncated to whole seconds so the hashed instant and the read-back agree (time_entries
    // precedent).
    eventAt: tsString("event_at").notNull(),
    eventOffsetMinutes: count("event_offset_minutes").notNull(),
    // The chain fields (computeAmendmentHash): this entry's hash, the predecessor's, the genesis flag.
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
    // THE backstop against two writers claiming one chain position (mirrors
    // `time_entries_chain_position_uq` / `registros_tenant_node_secuencia_uq`).
    unique("order_amendments_chain_position_key").on(t.workingOrderId, t.sequenceNo),
    index("order_amendments_order_idx").on(t.workingOrderId),
    check("order_amendments_sequence_no_ck", sql`${t.sequenceNo} > 0`),
    check("order_amendments_kind_ck", enumCheck(t.kind)),
    // SQLite has no regex operator, so the PostgreSQL `~ '^[0-9A-F]{64}$'` becomes two terms: the
    // length explicitly, and GLOB's negated class for the alphabet. GLOB is case-sensitive, unlike
    // LIKE. Measured on node:sqlite, Node v26.7.0, inserting into a table carrying exactly this
    // constraint: 64 uppercase hex accepted; 64 lowercase hex, 63 uppercase hex, and 64 characters
    // one of which is `Z` each refused. What it does NOT carry is the old column type's refusal of
    // a non-text value: in the same probe a 64-byte blob satisfied both terms, because `length()`
    // counts a blob's bytes, and a SQLite text column stores a blob (see ./columns.ts's header).
    check(
      "order_amendments_entry_hash_ck",
      sql`length(${t.entryHash}) = 64 and ${t.entryHash} not glob '*[^0-9A-F]*'`,
    ),
    check("order_amendments_event_offset_ck", sql`${t.eventOffsetMinutes} between -840 and 840`),
    // Until 2026-09-21 this read `date_trunc('second', event_at) = event_at`. `date_trunc` does not
    // exist on node:sqlite (`no such function: date_trunc`, measured), and the column is text now,
    // so the shape itself is what the check states. Measured on node:sqlite (Node v26.7.0), probe
    // /tmp/f1-ddl-probe/isots.mjs, inserting into a table carrying exactly this constraint:
    // `…T10:00:00.000Z` accepted; `…T10:00:00.250Z`, `…T10:00:00Z`, `…T10:00:00.000+02:00`,
    // a space instead of the `T`, and `not a timestamp` each refused. The writer is
    // `truncateToWholeSecond` in ../append-order-amendment.ts, whose `toISOString()` always emits
    // exactly this 24-character UTC form.
    //
    // STRONGER than what it replaces, deliberately: `timestamptz` refused a non-timestamp on its
    // own and a text column refuses nothing, so this is the only thing left saying the value is a
    // timestamp — the same move `enumCheck` makes for a vocabulary. It does NOT carry calendar
    // validity: `2026-02-31T10:00:00.000Z` is accepted, where the old column type refused it.
    check(
      "order_amendments_event_at_second_ck",
      sql`${t.eventAt} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'`,
    ),
    // Exactly one chain shape (mirrors time_entries_chaining_ck): the genesis carries no
    // predecessor, every later entry carries one.
    check(
      "order_amendments_chaining_ck",
      sql`(${t.isFirstEntry} and ${t.prevEntryHash} is null)
          or (not ${t.isFirstEntry} and ${t.prevEntryHash} is not null)`,
    ),
  ],
);
