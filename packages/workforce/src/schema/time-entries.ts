import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { locations, tenants, tills } from "@waitron/db";
import { persons } from "./persons.js";

/**
 * The kind of clock event. Slice 2 recorded the four capture kinds of a shift; `correction` (design
 * §5, an append row superseding an earlier value) is Slice 3's addition — a correction never mutates
 * an existing row (the immutability floor forbids UPDATE/DELETE), it APPENDS a `correction` entry
 * that carries the corrected timestamp and points at the entry it supersedes via `corrects_entry_id`.
 */
export const workforceEntryKind = pgEnum("workforce_entry_kind", [
  "in",
  "out",
  "break_start",
  "break_end",
  "correction",
]);

/**
 * A correction's lifecycle, append-only like everything else in this table. A `requested` correction
 * (the worker's art. 34.9 right to contest) is recorded but has NO projection effect; an `approved`
 * one supersedes its target on reprojection. Approval is not an UPDATE of the request — the floor
 * forbids that — it is a SECOND append (see WorkforceBackend.approveCorrection), so the request row
 * stays visible in history beside the approval.
 */
export const workforceCorrectionStatus = pgEnum("workforce_correction_status", [
  "requested",
  "approved",
]);

/**
 * The single append-only stream of clock events — the *registro de jornada* floor (art. 34.9).
 *
 * IMMUTABLE, unlike `persons`/`employments`: the app role holds only SELECT, INSERT, and
 * UPDATE/DELETE/TRUNCATE are revoked and backstopped by triggers
 * (drizzle/0003_workforce_d1a_rls.sql). A clock event is never rewritten or deleted; a mistake is
 * corrected by APPENDING a correction row (Slice 3), never by editing history. This is the same
 * role-revocation floor `registros_facturacion` carries, and the reason the record lives in Postgres
 * (which has a privilege system) rather than SQLite (which does not).
 *
 * `event_at` + `event_offset_minutes` are the trusted event timestamp and its wall offset (the
 * `sales.issued_at`/`issued_offset_minutes` pattern). `ingest_seq` is the append/ingest ORDER,
 * assigned by the database on insert — the projection sorts shifts by `event_at`, while the ingest
 * order is what the Slice-4 hash chain commits to (design §5: "project by timestamp, chain by
 * ingest"). A `GENERATED ALWAYS AS IDENTITY` column, not an app-supplied value: the app that may
 * only INSERT cannot forge or reorder the ingest sequence, which is exactly the property an
 * append-only ledger needs, and an identity column needs no separate sequence grant for the
 * SELECT/INSERT-only role.
 */
export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    personId: uuid("person_id").notNull(),
    /** The centro de trabajo the event was captured at — the workplace the Inspección scopes to. */
    locationId: uuid("location_id").notNull(),
    entryKind: workforceEntryKind("entry_kind").notNull(),
    /** The trusted event instant. `mode: "string"` keeps the offset out of the value the way
     * `sales.issued_at` does; the wall offset rides alongside in `event_offset_minutes`. */
    eventAt: timestamp("event_at", { withTimezone: true, mode: "string" }).notNull(),
    eventOffsetMinutes: integer("event_offset_minutes").notNull(),
    /** The till that captured the event, when one did — null for a manually recorded entry. */
    capturedByTillId: uuid("captured_by_till_id"),
    /** Who recorded the event. For a self-service clock-in this equals `person_id`; a supervisor
     * recording on someone's behalf differs, which is the attribution art. 34.9 requires. */
    recordedByPersonId: uuid("recorded_by_person_id").notNull(),
    /** Append/ingest order, assigned by the database. See the table doc comment. */
    ingestSeq: bigint("ingest_seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    /** The entry this row corrects — a base clock event, or an earlier correction (a correction is
     * itself immutable and is superseded by another). Null on a base event, non-null on a
     * `correction`. Self-referential FK; the projection follows it to resolve the effective value. */
    correctsEntryId: uuid("corrects_entry_id"),
    /** Why the correction was made (art. 34.9's attributable-and-contestable requirement). Null on a
     * base event. */
    correctionReason: text("correction_reason"),
    /** `requested` (no projection effect) or `approved` (supersedes its target). Null on a base
     * event. */
    correctionStatus: workforceCorrectionStatus("correction_status"),
    /** Who requested or approved the correction — the accountable actor, distinct from
     * `recorded_by_person_id` (the device operator) even when they are the same person. Null on a
     * base event. */
    correctionActorId: uuid("correction_actor_id"),
  },
  (t) => [
    // Array `foreignKey({...})` form throughout — see employments.ts for why the thunk form hurts
    // coverage. restrict everywhere: a clock event must never be orphaned by deleting the person,
    // location or till it attributes work to.
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "time_entries_tenant_fk",
    }).onDelete("restrict"),
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
    index("time_entries_tenant_id_idx").on(t.tenantId),
    index("time_entries_tenant_person_event_idx").on(t.tenantId, t.personId, t.eventAt),
    // The projection resolves each base event by looking up approved corrections that target it, so
    // the reverse lookup (rows correcting a given id) needs an index.
    index("time_entries_corrects_entry_idx").on(t.correctsEntryId),
    // Same wall-offset domain sales uses (±14h) — a stored offset outside it is a bug, not a zone.
    check("time_entries_event_offset_ck", sql`${t.eventOffsetMinutes} between -840 and 840`),
    // A row is EITHER a base clock event (all four correction columns null) OR a correction (all
    // four non-null) — never half of one. Deliberately does NOT reference the `'correction'` enum
    // literal: PostgreSQL forbids using an enum value in the same transaction that added it
    // (55P04), and a fresh-DB migration run adds `'correction'` and creates this constraint in one
    // go. The application sets `entry_kind = 'correction'` whenever these columns are populated; the
    // projection keys off that. All-null-or-all-non-null is what the database enforces.
    check(
      "time_entries_correction_shape_ck",
      sql`(${t.correctsEntryId} is null and ${t.correctionReason} is null
             and ${t.correctionStatus} is null and ${t.correctionActorId} is null)
          or (${t.correctsEntryId} is not null and ${t.correctionReason} is not null
             and ${t.correctionStatus} is not null and ${t.correctionActorId} is not null)`,
    ),
  ],
).enableRLS();
