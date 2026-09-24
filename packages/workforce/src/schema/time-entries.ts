import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  flag,
  id,
  label,
  locations,
  newId,
  nodes,
  table,
  tills,
  tsString,
} from "@waitron/db";
import { persons } from "@waitron/identity";

/**
 * The kind of clock event. A `correction` never mutates an existing row: it is appended, carrying the
 * corrected timestamp and pointing at the entry it supersedes via `corrects_entry_id`.
 */
export const workforceEntryKind = enumType(["in", "out", "break_start", "break_end", "correction"]);

/**
 * A `requested` correction has no projection effect; an `approved` one supersedes its target.
 * Approval is a second appended row, not an update of the request (`WorkforceBackend.approveCorrection`).
 */
export const workforceCorrectionStatus = enumType(["requested", "approved"]);

/**
 * The append-only stream of clock events — the working-time record (art. 34.9). A mistake is
 * corrected by appending a `correction` row, never by editing history. The append-only triggers
 * installed from `appendOnly("time_entries", …)` in ../classification.ts are the whole of that
 * enforcement and refuse this package's own writers too; SQLite has no trigger event for `DROP TABLE`.
 *
 * `recorded_at` is the recording node's clock at append, stamped by `appendToChain`, never by the
 * device; it orders corrections across nodes.
 */
export const timeEntries = table(
  "time_entries",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    personId: id("person_id").notNull(),
    locationId: id("location_id").notNull(),
    /** Stamped by the append, never by the device. With `location_id` it keys the chain, so each node
     * that writes a location keeps its own chain. */
    nodeId: id("node_id").notNull(),
    entryKind: workforceEntryKind("entry_kind").notNull(),
    eventAt: tsString("event_at").notNull(),
    eventOffsetMinutes: count("event_offset_minutes").notNull(),
    /** Null for a manually recorded entry. */
    capturedByTillId: id("captured_by_till_id"),
    /** Equals `person_id` for a self-service clock-in; differs when a supervisor records on someone's
     * behalf, which is the attribution art. 34.9 requires. */
    recordedByPersonId: id("recorded_by_person_id").notNull(),
    /** Whole seconds, hashed, and clamped monotonic per chain against the head's `last_recorded_at`. */
    recordedAt: tsString("recorded_at").notNull(),
    /** On a correction, the entry it supersedes — a base event or an earlier correction. */
    correctsEntryId: id("corrects_entry_id"),
    correctionReason: label("correction_reason"),
    correctionStatus: workforceCorrectionStatus("correction_status"),
    /** The accountable actor who requested or approved the correction, distinct from
     * `recorded_by_person_id` (the device operator) even when they are the same person. */
    correctionActorId: id("correction_actor_id"),
    // The hash chain, assigned by `appendToChain` (../chain.ts), never by the device.
    /** `computeEntryHash(content ‖ prev_entry_hash)`, uppercase hex. */
    entryHash: label("entry_hash").notNull(),
    /** Null on the genesis entry (hashed as empty). */
    prevEntryHash: label("prev_entry_hash"),
    /** The 1-based position within this (node, location) chain. */
    sequenceNo: count("sequence_no").notNull(),
    /** Exactly the first entry of a chain — not the current head, which is
     * `workforce_chains.last_entry_id`. */
    isFirstEntry: flag("is_first_entry").notNull(),
  },
  (t) => [
    // restrict everywhere: a clock event must never lose the person, location, till or node it
    // attributes work to.
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "time_entries_person_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "time_entries_location_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.capturedByTillId],
      foreignColumns: [tills.id],
      name: "time_entries_captured_by_till_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.recordedByPersonId],
      foreignColumns: [persons.id],
      name: "time_entries_recorded_by_person_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.nodeId],
      foreignColumns: [nodes.id],
      name: "time_entries_node_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.correctsEntryId],
      foreignColumns: [t.id],
      name: "time_entries_corrects_entry_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.correctionActorId],
      foreignColumns: [persons.id],
      name: "time_entries_correction_actor_fk",
    }).onDelete("restrict"),
    index("time_entries_person_event_idx").on(t.personId, t.eventAt),
    index("time_entries_corrects_entry_idx").on(t.correctsEntryId),
    // ±14h, the wall-offset domain `sales` uses.
    check("time_entries_event_offset_ck", sql`${t.eventOffsetMinutes} between -840 and 840`),
    // All four correction columns null, or all four set. Nothing here ties them to
    // `entry_kind = 'correction'`; the application sets that.
    check(
      "time_entries_correction_shape_ck",
      sql`(${t.correctsEntryId} is null and ${t.correctionReason} is null
             and ${t.correctionStatus} is null and ${t.correctionActorId} is null)
          or (${t.correctsEntryId} is not null and ${t.correctionReason} is not null
             and ${t.correctionStatus} is not null and ${t.correctionActorId} is not null)`,
    ),
    // The backstop against a forked chain: refuses a taken position whatever wrote the row.
    uniqueIndex("time_entries_chain_position_uq").on(t.nodeId, t.locationId, t.sequenceNo),
    // Mirrors `registros_huella_ck`, and shares its gap: a NUL byte after 64 hex digits passes,
    // because `length()` and `glob` stop at the first NUL.
    check(
      "time_entries_entry_hash_ck",
      sql`length(${t.entryHash}) = 64 and ${t.entryHash} not glob '*[^0-9A-F]*'`,
    ),
    check("time_entries_sequence_no_ck", sql`${t.sequenceNo} > 0`),
    check(
      "time_entries_chaining_ck",
      sql`(${t.isFirstEntry} and ${t.prevEntryHash} is null)
          or (not ${t.isFirstEntry} and ${t.prevEntryHash} is not null)`,
    ),
    // Only the whole-second UTC `toISOString()` form. The chain hashes `event_at` truncated to the
    // second, so a stored fractional second would recompute as tampered; and one spelling is what
    // makes text `<` and `order by` a time ordering. `appendToChain` truncates; this backstops any
    // other writer. A glob does not check the calendar (`2026-02-31T10:00:00.000Z` passes), and
    // like `time_entries_entry_hash_ck` it stops at a NUL byte, so anything after one passes.
    check(
      "time_entries_event_at_second_ck",
      sql`${t.eventAt} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'`,
    ),
    // Same shape and reason as `time_entries_event_at_second_ck`.
    check(
      "time_entries_recorded_at_second_ck",
      sql`${t.recordedAt} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'`,
    ),
    check("time_entries_entry_kind_ck", enumCheck(t.entryKind)),
    // A null passes this check; the correction-shape check decides when it may be null.
    check("time_entries_correction_status_ck", enumCheck(t.correctionStatus)),
  ],
);
