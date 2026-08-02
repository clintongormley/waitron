import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { locations, tenants, tills } from "@waitron/db";
import { persons } from "./persons.js";

/**
 * The kind of clock event. Slice 2 records the four capture kinds of a shift; `correction` (design
 * §5, an append row superseding an earlier value) is Slice 3 and is added to this enum then.
 */
export const workforceEntryKind = pgEnum("workforce_entry_kind", [
  "in",
  "out",
  "break_start",
  "break_end",
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
    index("time_entries_tenant_id_idx").on(t.tenantId),
    index("time_entries_tenant_person_event_idx").on(t.tenantId, t.personId, t.eventAt),
    // Same wall-offset domain sales uses (±14h) — a stored offset outside it is a bug, not a zone.
    check("time_entries_event_offset_ck", sql`${t.eventOffsetMinutes} between -840 and 840`),
  ],
).enableRLS();
