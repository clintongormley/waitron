import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { locations, nodes, tenants } from "@waitron/db";
import { timeEntries } from "./time-entries.js";

/**
 * The tamper-evidence chain head — MUTABLE, unlike the `time_entries` it points at. One row per
 * (tenant, node, location): a location's chain is written by ONE node at a time, but across a
 * promotion by two nodes in succession (the box, then a promoted cloud, then the box again), so
 * `node_id` joins the key to give each writer its own chain (spec §2.1). Row-locked with
 * `FOR UPDATE` during an append, as fiscal's `cadenas` is per (tenant, node).
 *
 * `sequence_no` is monotonic and NEVER reset — the chain position `time_entries.sequence_no` advances
 * from. `last_entry_id`/`last_entry_hash` are the predecessor an append reads to compute the next
 * `prev_entry_hash`. `last_recorded_at` is the high-water mark that keeps `recorded_at` monotonic per
 * chain (spec §4.1); it is null exactly when the pointer is.
 */
export const workforceChains = pgTable(
  "workforce_chains",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    sequenceNo: integer("sequence_no").notNull().default(0),
    lastEntryId: uuid("last_entry_id").references(() => timeEntries.id),
    lastEntryHash: text("last_entry_hash"),
    lastRecordedAt: timestamp("last_recorded_at", { withTimezone: true, mode: "string" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Drizzle stores this extraConfig callback lazily and runs it only when something walks the table's
  // full metadata. Unlike fiscal's `cadenas.ts`, this one IS exercised inside this package's own
  // `vitest run` — index.test.ts calls `getTableConfig(workforceChains)` to assert the composite key,
  // the foreign keys and the pointer check exist under the names the baseline uses —
  // so no `/* v8 ignore */` is needed: the callback runs and is genuinely covered.
  (t) => [
    primaryKey({ columns: [t.tenantId, t.nodeId, t.locationId] }),
    // The pointer and the high-water mark are each null on a fresh chain and each set once it has an
    // entry — a half-set pointer would leave the next append unable to decide genesis-vs-successor,
    // and a null `last_recorded_at` beside a set pointer would drop the monotonicity floor. Mirrors
    // `cadenas_puntero_ck`.
    check(
      "workforce_chains_pointer_ck",
      sql`(${t.lastEntryId} is null) = (${t.lastEntryHash} is null)
          and (${t.lastEntryId} is null) = (${t.lastRecordedAt} is null)`,
    ),
  ],
);
