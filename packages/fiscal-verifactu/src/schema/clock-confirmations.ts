import { sql } from "drizzle-orm";
import { check, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumType, id, json, newId, nodes, table, ts } from "@waitron/db";
import { clockChecks } from "./clock-checks.js";
import { registrosFacturacion } from "./registros.js";

export const clockConfirmationSource = enumType([
  "authority",
  "devices",
  "admin",
  "staff",
  "elapsed",
]);
export const clockConfirmationReason = enumType([
  "start",
  "change",
  "behind_chain",
  "disagrees",
  "unusable",
]);

/**
 * One row each time a check of the box's clock is closed. Every value a later writer needs is
 * declared now, because changing a CHECK later rebuilds the table. Declared `appendOnly()` in
 * `../classification.ts`.
 */
export const clockConfirmations = table(
  "clock_confirmations",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    // The writer reads `coalesce(max(seq), 0) + 1` in its own write transaction. Only one write
    // transaction runs at a time (`begin immediate` on the one write connection), so that is
    // unique, and the unique index refuses a duplicate loudly. It holds only while one node writes
    // this table at a time over a copy of the whole database; if `ledger` rows were ever drained
    // back from another node, `seq` would have to become per node. Not time order, because the
    // clock is what is in doubt.
    seq: count("seq").notNull(),
    nodeId: id("node_id")
      .notNull()
      .references(() => nodes.id),
    // The box's reading when the clock was judged, before any step.
    boxClockAt: ts("box_clock_at").notNull(),
    confirmedAt: ts("confirmed_at").notNull(),
    stepMs: count("step_ms").notNull(),
    source: clockConfirmationSource("source").notNull(),
    // The administrator or staff member who confirmed. No foreign key: `persons` is in
    // @waitron/identity's migration set, which this set does not require. Nothing checks that it
    // names a person.
    personId: id("person_id"),
    reason: clockConfirmationReason("reason").notNull(),
    proof: json<unknown>("proof").notNull(),
    checkId: id("check_id").references(() => clockChecks.id),
    registroId: id("registro_id").references(() => registrosFacturacion.id),
    recordAt: ts("record_at"),
  },
  (t) => [
    uniqueIndex("clock_confirmations_seq_uq").on(t.seq),
    uniqueIndex("clock_confirmations_check_uq").on(t.checkId),
    index("clock_confirmations_registro_idx").on(t.registroId),
    check("clock_confirmations_source_ck", enumCheck(t.source)),
    check("clock_confirmations_reason_ck", enumCheck(t.reason)),
    check(
      "clock_confirmations_person_ck",
      sql`(${t.source} in ('admin', 'staff')) = (${t.personId} is not null) and (${t.personId} is null or length(${t.personId}) > 0)`,
    ),
    check(
      "clock_confirmations_record_ck",
      sql`(${t.registroId} is null) = (${t.recordAt} is null)`,
    ),
  ],
);
