import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { locations, tenants } from "@waitron/db";
import { timeEntries } from "./time-entries.js";

/**
 * The tamper-evidence chain head — MUTABLE, unlike the `time_entries` it points at. One row per
 * (tenant, location): the *centro de trabajo* is the chain key, because the design (§5) chains one
 * stream per workplace and the launch venue runs a SINGLE active writer per location (the ratified
 * 2026-08-02 decision — active-active cross-writer chaining is a later, additive enrolment, NOT this
 * slice). Row-locked with `FOR UPDATE` during an append, exactly as fiscal's `cadenas` is per
 * (tenant, till).
 *
 * `sequence_no` is monotonic and NEVER reset — it is the chain position `time_entries.sequence_no`
 * advances from. `last_entry_id`/`last_entry_hash` are the predecessor an append reads to compute the
 * next `prev_entry_hash`; they are not denormalised content, only the two values the next hash needs,
 * so there is no second source of truth for anything the immutable row already holds.
 */
export const workforceChains = pgTable(
  "workforce_chains",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    sequenceNo: integer("sequence_no").notNull().default(0),
    lastEntryId: uuid("last_entry_id").references(() => timeEntries.id),
    lastEntryHash: text("last_entry_hash"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Drizzle stores this extraConfig callback lazily and runs it only when something walks the table's
  // full metadata. Unlike fiscal's `cadenas.ts`, this one IS exercised inside this package's own
  // `vitest run` — index.test.ts calls `getTableConfig(workforceChains)` to assert the composite key,
  // the foreign keys and the pointer check exist under the names the baseline uses —
  // so no `/* v8 ignore */` is needed: the callback runs and is genuinely covered.
  (t) => [
    primaryKey({ columns: [t.tenantId, t.locationId] }),
    // Both null (a fresh chain with no entries yet) or neither — a half-set pointer would leave the
    // next append unable to decide genesis-vs-successor unambiguously. Mirrors `cadenas_puntero_ck`.
    check(
      "workforce_chains_pointer_ck",
      sql`(${t.lastEntryId} is null) = (${t.lastEntryHash} is null)`,
    ),
  ],
);
