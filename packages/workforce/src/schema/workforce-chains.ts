import { sql } from "drizzle-orm";
import { check, primaryKey } from "drizzle-orm/sqlite-core";
import { count, id, label, locations, nodes, now, table, ts, tsString } from "@waitron/db";
import { timeEntries } from "./time-entries.js";

/**
 * The chain head — mutable, unlike the `time_entries` it points at. One row per (node, location), so
 * each node that writes a location keeps its own chain. `sequence_no` is never reset.
 * `last_recorded_at` is the high-water mark that keeps `recorded_at` monotonic per chain.
 */
export const workforceChains = table(
  "workforce_chains",
  {
    nodeId: id("node_id")
      .notNull()
      .references(() => nodes.id),
    locationId: id("location_id")
      .notNull()
      .references(() => locations.id),
    sequenceNo: count("sequence_no").notNull().default(0),
    lastEntryId: id("last_entry_id").references(() => timeEntries.id),
    lastEntryHash: label("last_entry_hash"),
    lastRecordedAt: tsString("last_recorded_at"),
    updatedAt: ts("updated_at").notNull().$defaultFn(now),
  },
  (t) => [
    primaryKey({ columns: [t.nodeId, t.locationId] }),
    // All three null on a fresh chain and all set once it has an entry: a half-set pointer would leave
    // the next append unable to decide genesis-vs-successor.
    check(
      "workforce_chains_pointer_ck",
      sql`(${t.lastEntryId} is null) = (${t.lastEntryHash} is null)
          and (${t.lastEntryId} is null) = (${t.lastRecordedAt} is null)`,
    ),
  ],
);
