import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, captureError, pgErrorCode, pgErrorMessage } from "@waitron/db";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { hashPin } from "./verify-pin.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import {
  insertAbsence,
  insertAvailability,
  insertDraftShift,
  insertRosterVersion,
  insertShiftSwap,
  insertShiftTemplate,
  insertTimeEntry,
  seedLocation,
  seedPerson,
} from "../test/fixtures.js";

let tenantId: string;

const suite = usePgliteDb({
  // Core first — the tenants foreign key. Ordering across packages is the runtime's job and
  // nothing enforces it, so it is explicit here.
  migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
  },
});

const PIN = hashPin("1234");

describe("the workforce migration set", () => {
  it("creates persons with row-level security both enabled and forced", async () => {
    // relforcerowsecurity is the load-bearing half: ENABLE alone (drizzle's .enableRLS(), migration
    // 0000) leaves the table owner and every superuser exempt, so the tenant policy would not bind
    // the deployment role. FORCE comes from the hand-written 0001 — deleting its FORCE line drops
    // relforcerowsecurity to false and fails this.
    const result = await suite.db.execute<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(sql`
      select relrowsecurity, relforcerowsecurity from pg_class where relname = 'persons'`);
    expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("stores a person and defaults role to staff and status to active", async () => {
    await suite.db.execute(sql`
      insert into persons (tenant_id, display_name, pin_hash)
      values (${tenantId}, 'Ana', ${PIN})`);
    const rows = await suite.db.execute<{ role: string; status: string }>(sql`
      select role, status from persons where tenant_id = ${tenantId} and display_name = 'Ana'`);
    expect(rows.rows[0]).toEqual({ role: "staff", status: "active" });
  });

  it("accepts every workforce_role value", async () => {
    for (const role of ["staff", "supervisor", "manager", "admin"]) {
      await suite.db.execute(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (${tenantId}, ${`role-${role}`}, ${PIN}, ${role})`);
    }
    const rows = await suite.db.execute<{ n: number }>(sql`
      select count(*)::int as n from persons
      where tenant_id = ${tenantId} and role in ('staff','supervisor','manager','admin')`);
    expect(rows.rows[0]!.n).toBeGreaterThanOrEqual(4);
  });

  it("rejects a role outside the enum", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (${tenantId}, 'Bad role', ${PIN}, 'ceo')`),
    );
    expect(pgErrorCode(error)).toBe("22P02"); // invalid_text_representation
  });

  it("rejects a status outside the enum", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into persons (tenant_id, display_name, pin_hash, status)
        values (${tenantId}, 'Bad status', ${PIN}, 'fired')`),
    );
    expect(pgErrorCode(error)).toBe("22P02");
  });

  it("rejects an empty display_name", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into persons (tenant_id, display_name, pin_hash)
        values (${tenantId}, '', ${PIN})`),
    );
    expect(pgErrorCode(error)).toBe("23514"); // check_violation
    expect(pgErrorMessage(error)).toMatch(/persons_display_name_ck/);
  });

  it("rejects an empty pin_hash", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into persons (tenant_id, display_name, pin_hash)
        values (${tenantId}, 'No pin', '')`),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/persons_pin_hash_ck/);
  });

  it("rejects a row whose tenant does not exist", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into persons (tenant_id, display_name, pin_hash)
        values (gen_random_uuid(), 'Orphan', ${PIN})`),
    );
    expect(pgErrorCode(error)).toBe("23503"); // foreign_key_violation
  });
});

describe("the D1a time & attendance tables", () => {
  async function seedPersonAndLocation(): Promise<{ personId: string; locationId: string }> {
    const personId = await seedPerson(suite.db, tenantId, `d1a-${crypto.randomUUID()}`);
    const locationId = await seedLocation(suite.db, tenantId);
    return { personId, locationId };
  }

  it("assigns ingest_seq in insertion order, increasing", async () => {
    // The design's append/ingest ordering column. GENERATED ALWAYS AS IDENTITY, so it climbs with
    // each INSERT regardless of event_at — deleting `.generatedAlwaysAsIdentity()` from the schema
    // makes the column app-supplied (NULL here) and this NOT NULL / ordering check fails.
    const { personId, locationId } = await seedPersonAndLocation();
    await insertTimeEntry(suite.db, {
      tenantId,
      personId,
      locationId,
      entryKind: "in",
      eventAt: "2026-01-05T09:00:00Z",
    });
    await insertTimeEntry(suite.db, {
      tenantId,
      personId,
      locationId,
      entryKind: "out",
      eventAt: "2026-01-05T17:00:00Z",
    });
    const rows = await suite.db.execute<{ entry_kind: string; ingest_seq: string }>(sql`
      select entry_kind, ingest_seq from time_entries
      where person_id = ${personId} order by ingest_seq`);
    const seqs = rows.rows.map((r) => Number(r.ingest_seq));
    expect(rows.rows.map((r) => r.entry_kind)).toEqual(["in", "out"]);
    expect(seqs[1]!).toBeGreaterThan(seqs[0]!);
  });

  it("rejects an entry_kind outside the enum", async () => {
    const { personId, locationId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into time_entries (
          tenant_id, person_id, location_id, entry_kind, event_at, event_offset_minutes,
          recorded_by_person_id
        ) values (
          ${tenantId}, ${personId}, ${locationId}, 'lunch', '2026-01-05T09:00:00Z', 0, ${personId})`),
    );
    expect(pgErrorCode(error)).toBe("22P02"); // invalid_text_representation
  });

  it("rejects an event_offset_minutes outside the ±840 range", async () => {
    const { personId, locationId } = await seedPersonAndLocation();
    // Valid genesis chain columns so ONLY the offset check is violated — the Slice-4 columns are
    // NOT NULL, so a raw insert must carry them or it fails on the wrong constraint.
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into time_entries (
          tenant_id, person_id, location_id, entry_kind, event_at, event_offset_minutes,
          recorded_by_person_id, entry_hash, sequence_no, is_first_entry
        ) values (
          ${tenantId}, ${personId}, ${locationId}, 'in', '2026-01-05T09:00:00Z', 900, ${personId},
          ${"A".repeat(64)}, 1, true)`),
    );
    expect(pgErrorCode(error)).toBe("23514"); // check_violation
    expect(pgErrorMessage(error)).toMatch(/time_entries_event_offset_ck/);
  });

  it("rejects a negative contracted_minutes_per_week", async () => {
    const { personId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into employments (
          tenant_id, person_id, contracted_minutes_per_week, contract_type, start_date, pay_rate
        ) values (${tenantId}, ${personId}, -1, 'full_time', '2026-01-01', '15.00')`),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/employments_contracted_minutes_ck/);
  });

  it("rejects an employment whose end_date precedes its start_date", async () => {
    const { personId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into employments (
          tenant_id, person_id, contracted_minutes_per_week, contract_type,
          start_date, end_date, pay_rate
        ) values (${tenantId}, ${personId}, 2400, 'full_time', '2026-06-01', '2026-01-01', '15.00')`),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/employments_dates_ck/);
  });
});

describe("the D1b correction columns", () => {
  async function seedBaseEntry(): Promise<{
    personId: string;
    locationId: string;
    entryId: string;
  }> {
    const personId = await seedPerson(suite.db, tenantId, `d1b-${crypto.randomUUID()}`);
    const locationId = await seedLocation(suite.db, tenantId);
    // Genesis chain columns (Slice 4, NOT NULL) so this base event is a valid position-1 entry; the
    // D1b tests below append their (deliberately malformed) correction at position 2 of the SAME
    // location, so the chain columns never collide on time_entries_chain_position_uq.
    const rows = await suite.db.execute<{ id: string }>(sql`
      insert into time_entries (
        tenant_id, person_id, location_id, entry_kind, event_at, event_offset_minutes,
        recorded_by_person_id, entry_hash, sequence_no, is_first_entry
      ) values (
        ${tenantId}, ${personId}, ${locationId}, 'in', '2026-01-05T09:00:00Z', 0, ${personId},
        ${"A".repeat(64)}, 1, true
      ) returning id`);
    return { personId, locationId, entryId: rows.rows[0]!.id };
  }

  it("accepts a fully-populated correction row (the ADD VALUE 'correction' landed)", async () => {
    // Proves migration 0004's `ALTER TYPE ... ADD VALUE 'correction'` applied: an entry_kind the
    // enum did not carry before is now insertable, with all four correction columns set.
    const { personId, locationId, entryId } = await seedBaseEntry();
    await suite.db.execute(sql`
      insert into time_entries (
        tenant_id, person_id, location_id, entry_kind, event_at, event_offset_minutes,
        recorded_by_person_id, corrects_entry_id, correction_reason, correction_status,
        correction_actor_id, entry_hash, prev_entry_hash, sequence_no, is_first_entry
      ) values (
        ${tenantId}, ${personId}, ${locationId}, 'correction', '2026-01-05T18:00:00Z', 0,
        ${personId}, ${entryId}, 'forgot to clock out', 'approved', ${personId},
        ${"B".repeat(64)}, ${"A".repeat(64)}, 2, false)`);
    const rows = await suite.db.execute<{ n: number }>(sql`
      select count(*)::int as n from time_entries
      where entry_kind = 'correction' and corrects_entry_id = ${entryId}`);
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("rejects a half-populated correction via the shape check", async () => {
    // corrects_entry_id set but the other three correction columns null — neither all-null (a base
    // event) nor all-non-null (a correction). Deleting the OR-arm of time_entries_correction_shape_ck
    // is what this catches.
    const { personId, locationId, entryId } = await seedBaseEntry();
    // Valid position-2 chain columns so ONLY the correction-shape check is violated.
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into time_entries (
          tenant_id, person_id, location_id, entry_kind, event_at, event_offset_minutes,
          recorded_by_person_id, corrects_entry_id, entry_hash, prev_entry_hash, sequence_no,
          is_first_entry
        ) values (
          ${tenantId}, ${personId}, ${locationId}, 'correction', '2026-01-05T18:00:00Z', 0,
          ${personId}, ${entryId}, ${"B".repeat(64)}, ${"A".repeat(64)}, 2, false)`),
    );
    expect(pgErrorCode(error)).toBe("23514"); // check_violation
    expect(pgErrorMessage(error)).toMatch(/time_entries_correction_shape_ck/);
  });

  it("rejects a base event carrying a stray correction column", async () => {
    // The other direction: an `in` event with correction_status set is neither shape. The same check
    // stops a base row from smuggling in correction metadata.
    const { personId, locationId } = await seedBaseEntry();
    // Valid position-2 chain columns so ONLY the correction-shape check (a base event with a stray
    // correction column) is violated.
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into time_entries (
          tenant_id, person_id, location_id, entry_kind, event_at, event_offset_minutes,
          recorded_by_person_id, correction_status, entry_hash, prev_entry_hash, sequence_no,
          is_first_entry
        ) values (
          ${tenantId}, ${personId}, ${locationId}, 'in', '2026-01-05T09:00:00Z', 0,
          ${personId}, 'requested', ${"B".repeat(64)}, ${"A".repeat(64)}, 2, false)`),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/time_entries_correction_shape_ck/);
  });

  it("rejects a correction whose corrects_entry_id references no entry", async () => {
    // The self-FK: a correction must point at a real entry.
    const { personId, locationId } = await seedBaseEntry();
    // Valid position-2 chain columns so ONLY the self-FK (a dangling corrects_entry_id) is violated.
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into time_entries (
          tenant_id, person_id, location_id, entry_kind, event_at, event_offset_minutes,
          recorded_by_person_id, corrects_entry_id, correction_reason, correction_status,
          correction_actor_id, entry_hash, prev_entry_hash, sequence_no, is_first_entry
        ) values (
          ${tenantId}, ${personId}, ${locationId}, 'correction', '2026-01-05T18:00:00Z', 0,
          ${personId}, ${crypto.randomUUID()}, 'dangling', 'approved', ${personId},
          ${"B".repeat(64)}, ${"A".repeat(64)}, 2, false)`),
    );
    expect(pgErrorCode(error)).toBe("23503"); // foreign_key_violation
  });
});

describe("the D2 scheduling tables (shifts + roster_versions)", () => {
  async function seedPersonAndLocation(): Promise<{ personId: string; locationId: string }> {
    const personId = await seedPerson(suite.db, tenantId, `d2-${crypto.randomUUID()}`);
    const locationId = await seedLocation(suite.db, tenantId);
    return { personId, locationId };
  }

  it("stores a draft roster version defaulting status to draft with a null published_at", async () => {
    const { locationId } = await seedPersonAndLocation();
    const versionId = await insertRosterVersion(suite.db, { tenantId, locationId });
    const rows = await suite.db.execute<{ status: string; published_at: string | null }>(sql`
      select status, published_at from roster_versions where id = ${versionId}`);
    expect(rows.rows[0]).toEqual({ status: "draft", published_at: null });
  });

  it("rejects a roster version whose period_end precedes its period_start", async () => {
    const { locationId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into roster_versions (tenant_id, location_id, period_start, period_end)
        values (${tenantId}, ${locationId}, '2026-03-08', '2026-03-02')`),
    );
    expect(pgErrorCode(error)).toBe("23514"); // check_violation
    expect(pgErrorMessage(error)).toMatch(/roster_versions_period_ck/);
  });

  it("rejects a published status carrying a null published_at (the publish-shape invariant)", async () => {
    // draft ⟺ published_at is null. A 'published' row with no stamp is neither shape. Deleting the
    // roster_versions_publish_shape_ck constraint is what this catches — and it is what stops
    // publishRoster from ever flipping status without stamping.
    const { locationId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into roster_versions (tenant_id, location_id, period_start, period_end, status)
        values (${tenantId}, ${locationId}, '2026-03-02', '2026-03-08', 'published')`),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/roster_versions_publish_shape_ck/);
  });

  it("rejects a draft status carrying a non-null published_at (the other direction)", async () => {
    const { locationId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into roster_versions (tenant_id, location_id, period_start, period_end, published_at)
        values (${tenantId}, ${locationId}, '2026-03-02', '2026-03-08', now())`),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/roster_versions_publish_shape_ck/);
  });

  it("stores a draft shift with a null roster_version_id", async () => {
    const { personId, locationId } = await seedPersonAndLocation();
    const shiftId = await insertDraftShift(suite.db, { tenantId, personId, locationId });
    const rows = await suite.db.execute<{ roster_version_id: string | null }>(sql`
      select roster_version_id from shifts where id = ${shiftId}`);
    expect(rows.rows[0]!.roster_version_id).toBeNull();
  });

  it("rejects a shift whose ends_at is not after its starts_at", async () => {
    const { personId, locationId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      insertDraftShift(suite.db, {
        tenantId,
        personId,
        locationId,
        startsAt: "2026-03-03T17:00:00Z",
        endsAt: "2026-03-03T09:00:00Z",
      }),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/shifts_interval_ck/);
  });

  it("rejects a shift whose starts_offset_minutes is outside the ±840 range", async () => {
    const { personId, locationId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      insertDraftShift(suite.db, {
        tenantId,
        personId,
        locationId,
        startsOffsetMinutes: 900,
      }),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/shifts_starts_offset_ck/);
  });
});

describe("the D2.2 planning tables (absences, availability, shift_templates, shift_swaps)", () => {
  async function seedPersonAndLocation(): Promise<{ personId: string; locationId: string }> {
    const personId = await seedPerson(suite.db, tenantId, `d22-${crypto.randomUUID()}`);
    const locationId = await seedLocation(suite.db, tenantId);
    return { personId, locationId };
  }

  it("stores an absence defaulting status to requested with a null note", async () => {
    const { personId } = await seedPersonAndLocation();
    const id = await insertAbsence(suite.db, { tenantId, personId, status: "requested" });
    const rows = await suite.db.execute<{ status: string; note: string | null }>(sql`
      select status, note from absences where id = ${id}`);
    expect(rows.rows[0]).toEqual({ status: "requested", note: null });
  });

  it("rejects an absence whose ends_on precedes its starts_on", async () => {
    const { personId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      insertAbsence(suite.db, {
        tenantId,
        personId,
        startsOn: "2026-03-10",
        endsOn: "2026-03-05",
      }),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/absences_range_ck/);
  });

  it("rejects an absence_kind outside the enum", async () => {
    const { personId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      insertAbsence(suite.db, { tenantId, personId, kind: "sabbatical" }),
    );
    expect(pgErrorCode(error)).toBe("22P02"); // invalid_text_representation
  });

  it("rejects an availability weekday outside 0–6", async () => {
    const { personId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      insertAvailability(suite.db, { tenantId, personId, weekday: 7 }),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/availability_weekday_ck/);
  });

  it("rejects an availability window whose end is not after its start", async () => {
    const { personId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      insertAvailability(suite.db, {
        tenantId,
        personId,
        availableFromMinute: 600,
        availableToMinute: 600,
      }),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/availability_window_ck/);
  });

  it("rejects an availability effective_to before its effective_from", async () => {
    const { personId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      insertAvailability(suite.db, {
        tenantId,
        personId,
        effectiveFrom: "2026-06-01",
        effectiveTo: "2026-01-01",
      }),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/availability_effective_ck/);
  });

  it("rejects a shift_template with an empty label", async () => {
    const { locationId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      insertShiftTemplate(suite.db, { tenantId, locationId, label: "" }),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/shift_templates_label_ck/);
  });

  it("rejects a shift_template weekday outside 0–6", async () => {
    const { locationId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      insertShiftTemplate(suite.db, { tenantId, locationId, weekday: -1 }),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/shift_templates_weekday_ck/);
  });

  it("stores a shift_swap defaulting status to requested, and cascades it away when its from_shift is deleted", async () => {
    // Also proves the from_shift FK is ON DELETE cascade: a swap is meaningless once its offered
    // shift is gone, so deleting the shift discards the swap (changing the FK to `restrict` fails the
    // delete; to `set null` leaves the row and fails the count-0 assertion).
    const { personId, locationId } = await seedPersonAndLocation();
    const toPerson = await seedPerson(suite.db, tenantId, `d22to-${crypto.randomUUID()}`);
    const fromShiftId = await insertDraftShift(suite.db, { tenantId, personId, locationId });
    const swapId = await insertShiftSwap(suite.db, {
      tenantId,
      requestedByPersonId: personId,
      fromShiftId,
      toPersonId: toPerson,
    });
    const created = await suite.db.execute<{ status: string }>(
      sql`select status from shift_swaps where id = ${swapId}`,
    );
    expect(created.rows[0]!.status).toBe("requested");

    await suite.db.execute(sql`delete from shifts where id = ${fromShiftId}`);
    const after = await suite.db.execute<{ n: number }>(
      sql`select count(*)::int as n from shift_swaps where id = ${swapId}`,
    );
    expect(after.rows[0]!.n).toBe(0);
  });

  it("rejects a shift_swap whose from_shift references no shift", async () => {
    const { personId } = await seedPersonAndLocation();
    const toPerson = await seedPerson(suite.db, tenantId, `d22to-${crypto.randomUUID()}`);
    const error = await captureError(() =>
      insertShiftSwap(suite.db, {
        tenantId,
        requestedByPersonId: personId,
        fromShiftId: crypto.randomUUID(),
        toPersonId: toPerson,
      }),
    );
    expect(pgErrorCode(error)).toBe("23503"); // foreign_key_violation
  });
});
