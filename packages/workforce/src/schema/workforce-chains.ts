import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { count, id, label, nodes, now, table, ts, tsString } from "@waitron/db";
import { timeEntries } from "./time-entries.js";

/**
 * The chain head — mutable, unlike the `time_entries` it points at. One row per node; `sequence_no`
 * is never reset, and `last_recorded_at` keeps `recorded_at` monotonic per chain.
 */
export const workforceChains = table(
  "workforce_chains",
  {
    nodeId: id("node_id")
      .primaryKey()
      .references(() => nodes.id),
    sequenceNo: count("sequence_no").notNull().default(0),
    lastEntryId: id("last_entry_id").references(() => timeEntries.id),
    lastEntryHash: label("last_entry_hash"),
    lastRecordedAt: tsString("last_recorded_at"),
    updatedAt: ts("updated_at").notNull().$defaultFn(now),
  },
  (t) => [
    // All three null on a fresh chain and all set once it has an entry: a half-set pointer would leave
    // the next append unable to decide genesis-vs-successor.
    check(
      "workforce_chains_pointer_ck",
      sql`(${t.lastEntryId} is null) = (${t.lastEntryHash} is null)
          and (${t.lastEntryId} is null) = (${t.lastRecordedAt} is null)`,
    ),
  ],
);
