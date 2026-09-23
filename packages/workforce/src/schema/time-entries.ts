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
 * The kind of clock event. Slice 2 recorded the four capture kinds of a shift; `correction` (design
 * §5, an append row superseding an earlier value) is Slice 3's addition — a correction never mutates
 * an existing row (the immutability floor forbids UPDATE/DELETE), it APPENDS a `correction` entry
 * that carries the corrected timestamp and points at the entry it supersedes via `corrects_entry_id`.
 */
export const workforceEntryKind = enumType(["in", "out", "break_start", "break_end", "correction"]);

/**
 * A correction's lifecycle, append-only like everything else in this table. A `requested` correction
 * (the worker's art. 34.9 right to contest) is recorded but has NO projection effect; an `approved`
 * one supersedes its target on reprojection. Approval is not an UPDATE of the request — the floor
 * forbids that — it is a SECOND append (see WorkforceBackend.approveCorrection), so the request row
 * stays visible in history beside the approval.
 */
export const workforceCorrectionStatus = enumType(["requested", "approved"]);

/**
 * The single append-only stream of clock events — the working-time record floor (art. 34.9).
 *
 * IMMUTABLE, unlike `persons`/`employments`: a clock event is never rewritten or deleted; a mistake
 * is corrected by APPENDING a correction row (Slice 3), never by editing history. What holds that
 * floor is a pair of triggers, `time_entries_append_only_update` and
 * `time_entries_append_only_delete`, which `installAppendOnlyTriggers`
 * (`packages/store/src/append-only.ts`) creates on every migrating path from the
 * `appendOnly("time_entries", …)` entry in ../classification.ts. Measured against a migrated
 * database on Node v26.7.0: an `UPDATE`, a `DELETE` and an `INSERT OR REPLACE` over this table are
 * each refused with `time_entries is append-only`, and the row is left as it was.
 * `registros_facturacion` carries the same floor by the same mechanism.
 *
 * The triggers are the whole floor, and they refuse every caller alike, this package's own writers
 * included. There is no TRUNCATE-blocking trigger, because SQLite has neither that statement nor a
 * trigger event for `DROP TABLE` (`packages/store/src/append-only.ts` states that gap). In the same
 * measurement `drop table time_entries` WAS refused, but with `FOREIGN KEY constraint failed` — by
 * the foreign keys the venue store switches on, not by anything append-only.
 *
 * `event_at` + `event_offset_minutes` are the trusted event timestamp and its wall offset (the
 * `sales.issued_at`/`issued_offset_minutes` pattern). `recorded_at` is the recording node's own clock
 * at append (whole seconds, hashed), stamped by `appendToChain` and never by the device — it orders
 * corrections across nodes and replaces the non-replicating `ingest_seq` the chain never covered
 * (spec §2.2). `sequence_no` is the chain position the tamper-evidence hash commits to.
 */
export const timeEntries = table(
  "time_entries",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    personId: id("person_id").notNull(),
    /** The workplace the event was captured at — the site the Inspección scopes to. */
    locationId: id("location_id").notNull(),
    /** The node whose chain this entry belongs to — stamped by the append, never by the device. Part
     * of the chain key (node, location) so a promoted cloud and a returning box each keep
     * their own chain (spec §2.1). */
    nodeId: id("node_id").notNull(),
    entryKind: workforceEntryKind("entry_kind").notNull(),
    /** The trusted event instant. `tsString`, like `sales.issuedAt`, keeps the offset out of the
     * value; the wall offset rides alongside in `event_offset_minutes`. */
    eventAt: tsString("event_at").notNull(),
    eventOffsetMinutes: count("event_offset_minutes").notNull(),
    /** The till that captured the event, when one did — null for a manually recorded entry. */
    capturedByTillId: id("captured_by_till_id"),
    /** Who recorded the event. For a self-service clock-in this equals `person_id`; a supervisor
     * recording on someone's behalf differs, which is the attribution art. 34.9 requires. */
    recordedByPersonId: id("recorded_by_person_id").notNull(),
    /** The recording node's clock at append, whole seconds. Stamped by `appendToChain` (never a
     * device input like `event_at`), hashed, and clamped monotonic per chain against the head's
     * `last_recorded_at` (spec §4.1). See the table doc comment. */
    recordedAt: tsString("recorded_at").notNull(),
    /** The entry this row corrects — a base clock event, or an earlier correction (a correction is
     * itself immutable and is superseded by another). Null on a base event, non-null on a
     * `correction`. Self-referential FK; the projection follows it to resolve the effective value. */
    correctsEntryId: id("corrects_entry_id"),
    /** Why the correction was made (art. 34.9's attributable-and-contestable requirement). Null on a
     * base event. */
    correctionReason: label("correction_reason"),
    /** `requested` (no projection effect) or `approved` (supersedes its target). Null on a base
     * event. */
    correctionStatus: workforceCorrectionStatus("correction_status"),
    /** Who requested or approved the correction — the accountable actor, distinct from
     * `recorded_by_person_id` (the device operator) even when they are the same person. Null on a
     * base event. */
    correctionActorId: id("correction_actor_id"),
    // Slice 4 — the tamper-evidence hash chain (design §5). Assigned by `appendToChain`
    // (../chain.ts), never by the device: one chain per (node, location), one active writer per
    // chain. `time_entries_chain_position_uq` below is what refuses a forked position, measured on
    // this engine by chain.test.ts's `rejects a second entry claiming an occupied chain position`.
    // IMMUTABLE like the rest of the row: the append-only triggers named in this table's doc comment
    // refuse an UPDATE whatever column it names, so these carry nothing of their own.
    /** This entry's own hash — `computeEntryHash(content ‖ prev_entry_hash)`, uppercase hex. */
    entryHash: label("entry_hash").notNull(),
    /** The predecessor's `entry_hash`; null on the genesis entry (hashed as empty). */
    prevEntryHash: label("prev_entry_hash"),
    /** The 1-based position within this (node, location) chain — `workforce_chains.sequence_no`
     * advanced by one. Contiguous and ours, and the position the tamper-evidence hash commits to. */
    sequenceNo: count("sequence_no").notNull(),
    /** The genesis marker: exactly the first entry of a chain. NOT the mutable "current head" — that
     * is `workforce_chains.last_entry_id`. Named for the fiscal precedent's `primer_registro` shape
     * (first record), whose CHECK this mirrors below. */
    isFirstEntry: flag("is_first_entry").notNull(),
  },
  (t) => [
    // Array `foreignKey({...})` form throughout — see employments.ts for why the thunk form hurts
    // coverage. restrict everywhere: a clock event must never be orphaned by deleting the person,
    // location or till it attributes work to.
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
    // The chain-key node. restrict, like every FK here — a node with entries must never be deleted
    // out from under its chain.
    foreignKey({
      columns: [t.nodeId],
      foreignColumns: [nodes.id],
      name: "time_entries_node_fk",
    }).onDelete("restrict"),
    // Self-referential: a correction points at the entry it supersedes. restrict, like every other
    // FK here — the target of a correction must never be deleted out from under it.
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
    // The projection resolves each base event by looking up approved corrections that target it, so
    // the reverse lookup (rows correcting a given id) needs an index.
    index("time_entries_corrects_entry_idx").on(t.correctsEntryId),
    // Same wall-offset domain sales uses (±14h) — a stored offset outside it is a bug, not a zone.
    check("time_entries_event_offset_ck", sql`${t.eventOffsetMinutes} between -840 and 840`),
    // A row is EITHER a base clock event (all four correction columns null) OR a correction (all
    // four non-null) — never half of one. The application sets `entry_kind = 'correction'` whenever
    // these columns are populated; the projection keys off that. All-null-or-all-non-null is what
    // the database enforces.
    //
    // It does not reference the `'correction'` literal, and no longer needs a reason not to. The
    // reason was PostgreSQL's: `entry_kind` was a real enum TYPE there, a value could not be used in
    // the same transaction that added it (55P04), and a fresh-database migration run added
    // `'correction'` and created this constraint in one go. On this engine `enumType` is a plain
    // text column, and what lists the values is the separate `time_entries_entry_kind_ck` at the
    // foot of this list — so nothing would refuse the literal.
    check(
      "time_entries_correction_shape_ck",
      sql`(${t.correctsEntryId} is null and ${t.correctionReason} is null
             and ${t.correctionStatus} is null and ${t.correctionActorId} is null)
          or (${t.correctsEntryId} is not null and ${t.correctionReason} is not null
             and ${t.correctionStatus} is not null and ${t.correctionActorId} is not null)`,
    ),
    // THE backstop against a fork of the working-time chain: it refuses a taken position whatever
    // wrote it, INCLUDING a row that never went through `appendToChain` — proved by deletion in
    // ../chain.test.ts's "rejects a second entry claiming an occupied chain position". What it is
    // not backstopping is a lost read-then-write race between two overlapping appends: one write
    // transaction runs on the venue file at a time, so there is no second append to overlap with
    // (`selectHead`, ../chain.ts), and the retry there stays for the reason stated on
    // `MAX_APPEND_ATTEMPTS`. Keyed on the full chain key (node, location), so two nodes at one
    // location never collide across a promotion.
    uniqueIndex("time_entries_chain_position_uq").on(t.nodeId, t.locationId, t.sequenceNo),
    // The stored hash is uppercase SHA-256 hex (../chain-hash.ts). Mirrors `registros_huella_ck`,
    // including the rewrite away from `~ '^[0-9A-F]{64}$'` and the NUL gap that rewrite does not
    // carry — the measurement is stated once, on `registros_huella_ck` itself, in the
    // fiscal-verifactu package's schema. Named by constraint rather than by file path on purpose:
    // this is a generic package, and the path spells a fiscal term as a bare word, which
    // `scripts/english-only.test.ts` refuses here (CLAUDE.md §3).
    check(
      "time_entries_entry_hash_ck",
      sql`length(${t.entryHash}) = 64 and ${t.entryHash} not glob '*[^0-9A-F]*'`,
    ),
    check("time_entries_sequence_no_ck", sql`${t.sequenceNo} > 0`),
    // Exactly one chain shape, mirroring the fiscal `registros_encadenamiento_ck`: the genesis entry
    // carries no predecessor, every later entry carries one. `is_first_entry` and `prev_entry_hash`
    // can never disagree.
    check(
      "time_entries_chaining_ck",
      sql`(${t.isFirstEntry} and ${t.prevEntryHash} is null)
          or (not ${t.isFirstEntry} and ${t.prevEntryHash} is not null)`,
    ),
    // Defence-in-depth for the Slice-4 hash chain: `event_at` must carry NO sub-second component.
    // The chain hashes `event_at` as the absolute instant (chain-hash.ts) after truncating it to a
    // whole second, so a row whose stored value kept a fractional second would carry one spelling in
    // the column and another in the hash, and recompute as tampered — a false `hash_mismatch` on
    // genuine data. This CHECK is also what gives the column ONE spelling, which is what `<` and
    // `order by` on a text timestamp need to be a time ordering. `appendToChain` truncates to whole seconds at the write choke point (../chain.ts); this
    // CHECK backstops any writer that bypasses it (the escape-or-validate ethos, CLAUDE.md §3).
    //
    // Replaced 2026-09-21, when the engine changed: this was
    // `date_trunc('second', event_at) = event_at`, and `date_trunc` does not exist on SQLite (`no
    // such function: date_trunc`, measured on node:sqlite, Node v26.7.0). The whole 24-character
    // shape is pinned by a glob instead — `truncateToWholeSecond` (../chain.ts) writes
    // `new Date(...).toISOString()`, which is always exactly that form, UTC and whole-second.
    // It is NOT a like-for-like swap, in both directions, measured the same day on both engines:
    //   - Stronger, deliberately. The column was `timestamp with time zone` and refused a
    //     non-timestamp itself; a SQLite text column refuses nothing, so this check is now the only
    //     thing saying the value is a timestamp at all. On node:sqlite it refuses
    //     `2026-09-21T10:00:00.250Z` (the sub-second value the old check existed for),
    //     `2026-09-21T10:00:00Z`, `2026-09-21T10:00:00.000+02:00`, `2026-09-21 10:00:00.000Z` and
    //     `not a timestamp`. Same move as `enumCheck` above: put the lost refusal back.
    //   - Weaker in one way: a glob does not parse a date, so it does not carry calendar validity.
    //     `2026-02-31T10:00:00.000Z` is ACCEPTED here; on PGlite the old column refused it with
    //     `22008 date/time field value out of range`.
    check(
      "time_entries_event_at_second_ck",
      sql`${t.eventAt} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'`,
    ),
    // Same whole-second defence for `recorded_at`: it is hashed as the instant, so a stored
    // sub-second component would leave one spelling in the column and another in the hash. `appendToChain` truncates at the write choke point; this CHECK backstops it,
    // mirroring `time_entries_event_at_second_ck`.
    // Same rewrite, and the same two differences from what it replaced, as
    // time_entries_event_at_second_ck above — the measurement is stated once there. `recorded_at`
    // is written by the same `new Date(...).toISOString()` shape in `appendToChain`.
    check(
      "time_entries_recorded_at_second_ck",
      sql`${t.recordedAt} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'`,
    ),
    // The two refusals the PostgreSQL enum TYPES performed, put back as constraints: both columns
    // are plain text on SQLite and refuse nothing on their own (see enumText in
    // packages/db/src/schema/columns.ts). `correction_status` is nullable on a base event, which
    // this shape still admits — measured 2026-09-21 on node:sqlite (Node v26.7.0), a NULL inserted
    // against `check (v in ('requested','approved'))` is ACCEPTED and `'other'` is refused.
    check("time_entries_entry_kind_ck", enumCheck(t.entryKind)),
    check("time_entries_correction_status_ck", enumCheck(t.correctionStatus)),
  ],
);
