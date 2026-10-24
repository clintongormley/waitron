import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumType, id, json, newId, nodes, table, ts } from "@waitron/db";

export const clockCheckReason = enumType(["start", "change", "behind_chain", "disagrees"]);

/**
 * One row each time the box opens a check of its own clock. A check is open while no
 * `clock_confirmations` row names it. Declared `appendOnly()` in `../classification.ts`.
 */
export const clockChecks = table(
  "clock_checks",
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
    // The box's own reading when the check opened.
    openedAt: ts("opened_at").notNull(),
    reason: clockCheckReason("reason").notNull(),
    detail: json<unknown>("detail").notNull(),
  },
  (t) => [
    uniqueIndex("clock_checks_seq_uq").on(t.seq),
    check("clock_checks_reason_ck", enumCheck(t.reason)),
  ],
);
