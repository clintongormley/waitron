import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  FOREIGN_KEY_VIOLATION,
  UNIQUE_VIOLATION,
  captureError,
  engineErrorMessage,
  isRefusal,
  newId,
  nowIso,
} from "@waitron/db";
import { IDENTITY_MIGRATIONS, hashPin } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  insertAbsence,
  insertAvailability,
  insertDraftShift,
  insertRosterVersion,
  insertShiftSwap,
  insertShiftTemplate,
  seedLocation,
  seedPerson,
} from "../test/fixtures.js";

const suite = useVenueDb({
  resetPerTest: false,
  // Core for the setup, which seeds its `tenants`, and for the cases, which seed its `locations`
  // and `nodes` (`seedLocation`, `seedNode`); identity for `persons`, which the first cases write
  // and workforce's tables reference. Listed in manifest order; the suite also passes with the
  // list reversed (measured 2026-09-23).
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
  },
});

const PIN = hashPin("1234");

/** The two values every raw insert below has to supply itself: `id` and `created_at` come from the
 * table's `$defaultFn` generators, which drizzle runs for a BUILDER insert and never for raw SQL,
 * and the generated DDL declares neither with a SQL DEFAULT — without them the statement is refused
 * `NOT NULL constraint failed: <table>.id`. Every insert here stays raw deliberately: what it is
 * proving is the constraint or DEFAULT the MIGRATION declares, not the values drizzle would send. */
function rowIdentity() {
  return sql`${newId()}, ${nowIso()}`;
}

// persons is created by the IDENTITY migration set, which this suite applies with WORKFORCE because
// employments/time_entries reference it. These integration checks prove the combined
// [core, identity, workforce] stack lands persons correctly.
describe("persons, from the identity migration set layered under workforce", () => {
  it("stores a person and defaults role to staff and status to active", async () => {
    await suite.db.execute(sql`
      insert into persons (id, created_at, display_name, pin_hash)
      values (${rowIdentity()}, 'Ana', ${PIN})`);
    const rows = await suite.db.execute<{ role: string; status: string }>(sql`
      select role, status from persons where display_name = 'Ana'`);
    expect(rows.rows[0]).toEqual({ role: "staff", status: "active" });
  });

  it("accepts every person_role value", async () => {
    for (const role of ["staff", "supervisor", "manager", "admin"]) {
      await suite.db.execute(sql`
        insert into persons (id, created_at, display_name, pin_hash, role)
        values (${rowIdentity()}, ${`role-${role}`}, ${PIN}, ${role})`);
    }
    const rows = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from persons
      where role in ('staff','supervisor','manager','admin')`);
    expect(rows.rows[0]!.n).toBeGreaterThanOrEqual(4);
  });

  it("rejects a role outside the enum", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into persons (id, created_at, display_name, pin_hash, role)
        values (${rowIdentity()}, 'Bad role', ${PIN}, 'ceo')`),
    );
    // The refusal the PostgreSQL enum TYPE performed on its own is now a named CHECK constraint on
    // a plain text column (`enumCheck`, packages/db/src/schema/columns.ts), so the class is a check
    // violation rather than the old `22P02`. The constraint NAME is asserted too: the class alone
    // is also satisfied by any of the eleven other checks on this table.
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/persons_role_ck/);
  });

  it("rejects a status outside the enum", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into persons (id, created_at, display_name, pin_hash, status)
        values (${rowIdentity()}, 'Bad status', ${PIN}, 'fired')`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/persons_status_ck/);
  });

  it("rejects an empty display_name", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into persons (id, created_at, display_name, pin_hash)
        values (${rowIdentity()}, '', ${PIN})`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/persons_display_name_ck/);
  });

  it("rejects an empty pin_hash", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into persons (id, created_at, display_name, pin_hash)
        values (${rowIdentity()}, 'No pin', '')`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/persons_pin_hash_ck/);
  });
});

describe("the D1a time & attendance tables", () => {
  async function seedPersonAndLocation(): Promise<{
    personId: string;
    locationId: string;
    nodeId: string;
  }> {
    const personId = await seedPerson(suite.db, `d1a-${crypto.randomUUID()}`);
    const locationId = await seedLocation(suite.db);
    const nodeId = await seedNode(suite.db, brandLocationId(locationId));
    return { personId, locationId, nodeId };
  }

  it("rejects an entry_kind outside the enum", async () => {
    const { personId, locationId, nodeId } = await seedPersonAndLocation();
    // Valid genesis chain columns, like the offset case below: the enum's refusal is now a CHECK
    // constraint rather than a value-coercion error, and a check runs AFTER the NOT NULL columns
    // are read — so a row missing `node_id`/`recorded_at`/the Slice-4 columns would be refused on
    // the wrong constraint and the case would pass without ever reaching `entry_kind`.
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into time_entries (
          id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
          recorded_by_person_id, recorded_at, entry_hash, sequence_no, is_first_entry
        ) values (${newId()}, ${personId}, ${locationId}, ${nodeId}, 'lunch',
          '2026-01-05T09:00:00.000Z', 0, ${personId}, '2026-01-05T09:00:00.000Z',
          ${"A".repeat(64)}, 1, true)`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/time_entries_entry_kind_ck/);
  });

  it("rejects an event_offset_minutes outside the ±840 range", async () => {
    const { personId, locationId, nodeId } = await seedPersonAndLocation();
    // Valid genesis chain columns (node_id, recorded_at and the Slice-4 columns are all NOT NULL) so
    // ONLY the offset check is violated — a raw insert must carry them or it fails on the wrong
    // constraint.
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into time_entries (
          id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
          recorded_by_person_id, recorded_at, entry_hash, sequence_no, is_first_entry
        ) values (${newId()}, ${personId}, ${locationId}, ${nodeId}, 'in', '2026-01-05T09:00:00.000Z', 900,
          ${personId}, '2026-01-05T09:00:00.000Z', ${"A".repeat(64)}, 1, true)`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/time_entries_event_offset_ck/);
  });

  it("rejects a negative contracted_minutes_per_week", async () => {
    const { personId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into employments (
          id, created_at, person_id, contracted_minutes_per_week, contract_type, start_date, pay_rate
        ) values (${rowIdentity()}, ${personId}, -1, 'full_time', '2026-01-01', 1500)`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/employments_contracted_minutes_ck/);
  });

  it("rejects an employment whose end_date precedes its start_date", async () => {
    const { personId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into employments (
          id, created_at, person_id, contracted_minutes_per_week, contract_type,
          start_date, end_date, pay_rate
        ) values (${rowIdentity()}, ${personId}, 2400, 'full_time', '2026-06-01', '2026-01-01', 1500)`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/employments_dates_ck/);
  });
});

describe("the D1b correction columns", () => {
  async function seedBaseEntry(): Promise<{
    personId: string;
    locationId: string;
    nodeId: string;
    entryId: string;
  }> {
    const personId = await seedPerson(suite.db, `d1b-${crypto.randomUUID()}`);
    const locationId = await seedLocation(suite.db);
    const nodeId = await seedNode(suite.db, brandLocationId(locationId));
    // Genesis chain columns (node_id, recorded_at + the Slice-4 columns, all NOT NULL) so this base
    // event is a valid position-1 entry; the D1b tests below append their (deliberately malformed)
    // correction at position 2 of the SAME (node, location), so the chain columns never collide on
    // time_entries_chain_position_uq. The instants carry `.000Z` because
    // `time_entries_event_at_second_ck` admits exactly that spelling of a whole second — a raw
    // insert writing `…09:00:00Z` is refused on THAT constraint, before reaching the one the case
    // is about.
    const rows = await suite.db.execute<{ id: string }>(sql`
      insert into time_entries (
        id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
        recorded_by_person_id, recorded_at, entry_hash, sequence_no, is_first_entry
      ) values (${newId()}, ${personId}, ${locationId}, ${nodeId}, 'in', '2026-01-05T09:00:00.000Z', 0,
        ${personId}, '2026-01-05T09:00:00.000Z', ${"A".repeat(64)}, 1, true
      ) returning id`);
    return { personId, locationId, nodeId, entryId: rows.rows[0]!.id };
  }

  it("accepts a fully-populated correction row (the ADD VALUE 'correction' landed)", async () => {
    // Proves migration 0002's `ALTER TYPE ... ADD VALUE 'correction'` applied: an entry_kind the
    // enum did not carry before is now insertable, with all four correction columns set.
    const { personId, locationId, nodeId, entryId } = await seedBaseEntry();
    await suite.db.execute(sql`
      insert into time_entries (
        id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
        recorded_by_person_id, recorded_at, corrects_entry_id, correction_reason, correction_status,
        correction_actor_id, entry_hash, prev_entry_hash, sequence_no, is_first_entry
      ) values (${newId()}, ${personId}, ${locationId}, ${nodeId}, 'correction', '2026-01-05T18:00:00.000Z', 0,
        ${personId}, '2026-01-05T18:00:00.000Z', ${entryId}, 'forgot to clock out', 'approved', ${personId},
        ${"B".repeat(64)}, ${"A".repeat(64)}, 2, false)`);
    const rows = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from time_entries
      where entry_kind = 'correction' and corrects_entry_id = ${entryId}`);
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("rejects a half-populated correction via the shape check", async () => {
    // corrects_entry_id set but the other three correction columns null — neither all-null (a base
    // event) nor all-non-null (a correction). Deleting the OR-arm of time_entries_correction_shape_ck
    // is what this catches.
    const { personId, locationId, nodeId, entryId } = await seedBaseEntry();
    // Valid position-2 chain columns so ONLY the correction-shape check is violated.
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into time_entries (
          id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
          recorded_by_person_id, recorded_at, corrects_entry_id, entry_hash, prev_entry_hash,
          sequence_no, is_first_entry
        ) values (${newId()}, ${personId}, ${locationId}, ${nodeId}, 'correction', '2026-01-05T18:00:00.000Z', 0,
          ${personId}, '2026-01-05T18:00:00.000Z', ${entryId}, ${"B".repeat(64)}, ${"A".repeat(64)}, 2, false)`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/time_entries_correction_shape_ck/);
  });

  it("rejects a base event carrying a stray correction column", async () => {
    // The other direction: an `in` event with correction_status set is neither shape. The same check
    // stops a base row from smuggling in correction metadata.
    const { personId, locationId, nodeId } = await seedBaseEntry();
    // Valid position-2 chain columns so ONLY the correction-shape check (a base event with a stray
    // correction column) is violated.
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into time_entries (
          id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
          recorded_by_person_id, recorded_at, correction_status, entry_hash, prev_entry_hash,
          sequence_no, is_first_entry
        ) values (${newId()}, ${personId}, ${locationId}, ${nodeId}, 'in', '2026-01-05T09:00:00.000Z', 0,
          ${personId}, '2026-01-05T09:00:00.000Z', 'requested', ${"B".repeat(64)}, ${"A".repeat(64)}, 2, false)`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/time_entries_correction_shape_ck/);
  });

  it("rejects a correction whose corrects_entry_id references no entry", async () => {
    // The self-FK: a correction must point at a real entry.
    const { personId, locationId, nodeId } = await seedBaseEntry();
    // Valid position-2 chain columns so ONLY the self-FK (a dangling corrects_entry_id) is violated.
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into time_entries (
          id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
          recorded_by_person_id, recorded_at, corrects_entry_id, correction_reason, correction_status,
          correction_actor_id, entry_hash, prev_entry_hash, sequence_no, is_first_entry
        ) values (${newId()}, ${personId}, ${locationId}, ${nodeId}, 'correction', '2026-01-05T18:00:00.000Z', 0,
          ${personId}, '2026-01-05T18:00:00.000Z', ${crypto.randomUUID()}, 'dangling', 'approved', ${personId},
          ${"B".repeat(64)}, ${"A".repeat(64)}, 2, false)`),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });
});

describe("the D2 scheduling tables (shifts + roster_versions)", () => {
  async function seedPersonAndLocation(): Promise<{ personId: string; locationId: string }> {
    const personId = await seedPerson(suite.db, `d2-${crypto.randomUUID()}`);
    const locationId = await seedLocation(suite.db);
    return { personId, locationId };
  }

  it("stores a draft roster version defaulting status to draft with a null published_at", async () => {
    const { locationId } = await seedPersonAndLocation();
    const versionId = await insertRosterVersion(suite.db, { locationId });
    const rows = await suite.db.execute<{ status: string; published_at: string | null }>(sql`
      select status, published_at from roster_versions where id = ${versionId}`);
    expect(rows.rows[0]).toEqual({ status: "draft", published_at: null });
  });

  it("rejects a roster version whose period_end precedes its period_start", async () => {
    const { locationId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into roster_versions (id, created_at, location_id, period_start, period_end)
        values (${rowIdentity()}, ${locationId}, '2026-03-08', '2026-03-02')`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/roster_versions_period_ck/);
  });

  it("rejects a published status carrying a null published_at (the publish-shape invariant)", async () => {
    // draft ⟺ published_at is null. A 'published' row with no stamp is neither shape. Deleting the
    // roster_versions_publish_shape_ck constraint is what this catches — and it is what stops
    // publishRoster from ever flipping status without stamping.
    const { locationId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into roster_versions (id, created_at, location_id, period_start, period_end, status)
        values (${rowIdentity()}, ${locationId}, '2026-03-02', '2026-03-08', 'published')`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/roster_versions_publish_shape_ck/);
  });

  it("rejects a draft status carrying a non-null published_at (the other direction)", async () => {
    const { locationId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into roster_versions (id, created_at, location_id, period_start, period_end, published_at)
        values (${rowIdentity()}, ${locationId}, '2026-03-02', '2026-03-08', ${nowIso()})`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/roster_versions_publish_shape_ck/);
  });

  it("rejects a second published version for the same (location, period) via the partial unique index", async () => {
    // roster_versions_published_period_uq at most one PUBLISHED version per (location,
    // exact period). Insert one published row directly (with a stamp so publish-shape passes),
    // then a second identical-period published row is rejected 23505. Prove by deletion: drop the
    // CREATE UNIQUE INDEX and the second insert succeeds (two published rows coexist).
    const { locationId } = await seedPersonAndLocation();
    await suite.db.execute(sql`
      insert into roster_versions (id, created_at, location_id, period_start, period_end, status, published_at)
      values (${rowIdentity()}, ${locationId}, '2026-05-04', '2026-05-10', 'published', ${nowIso()})`);
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into roster_versions (id, created_at, location_id, period_start, period_end, status, published_at)
        values (${rowIdentity()}, ${locationId}, '2026-05-04', '2026-05-10', 'published', ${nowIso()})`),
    );
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
    // SQLite names the index's COLUMNS, never the index: the message is
    // `UNIQUE constraint failed: roster_versions.location_id, roster_versions.period_start,
    // roster_versions.period_end`. That is what discriminates here, so it is what is asserted —
    // `roster_versions_published_period_uq` is the only unique index on this table, and it is the
    // only one over those three columns.
    expect(engineErrorMessage(error)).toMatch(
      /UNIQUE constraint failed: roster_versions\.location_id, roster_versions\.period_start, roster_versions\.period_end/,
    );
  });

  it("allows two DRAFT versions for the same period — the published-only index is partial", async () => {
    // The index is WHERE status = 'published', so drafts (and superseded rows) for one period
    // accumulate freely; only the live published row is unique. A non-partial unique index here would
    // wrongly reject a second draft for a period being re-planned.
    const { locationId } = await seedPersonAndLocation();
    await insertRosterVersion(suite.db, {
      locationId,
      periodStart: "2026-05-11",
      periodEnd: "2026-05-17",
    });
    await insertRosterVersion(suite.db, {
      locationId,
      periodStart: "2026-05-11",
      periodEnd: "2026-05-17",
    });
    const rows = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from roster_versions
      where location_id = ${locationId}
        and period_start = '2026-05-11' and period_end = '2026-05-17'`);
    expect(rows.rows[0]!.n).toBe(2);
  });

  it("stores a draft shift with a null roster_version_id", async () => {
    const { personId, locationId } = await seedPersonAndLocation();
    const shiftId = await insertDraftShift(suite.db, { personId, locationId });
    const rows = await suite.db.execute<{ roster_version_id: string | null }>(sql`
      select roster_version_id from shifts where id = ${shiftId}`);
    expect(rows.rows[0]!.roster_version_id).toBeNull();
  });

  it("rejects a shift whose ends_at is not after its starts_at", async () => {
    const { personId, locationId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      insertDraftShift(suite.db, {
        personId,
        locationId,
        startsAt: "2026-03-03T17:00:00Z",
        endsAt: "2026-03-03T09:00:00Z",
      }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/shifts_interval_ck/);
  });

  it("rejects a shift whose starts_offset_minutes is outside the ±840 range", async () => {
    const { personId, locationId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      insertDraftShift(suite.db, {
        personId,
        locationId,
        startsOffsetMinutes: 900,
      }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/shifts_starts_offset_ck/);
  });
});

describe("the D2.2 planning tables (absences, availability, shift_templates, shift_swaps)", () => {
  async function seedPersonAndLocation(): Promise<{ personId: string; locationId: string }> {
    const personId = await seedPerson(suite.db, `d22-${crypto.randomUUID()}`);
    const locationId = await seedLocation(suite.db);
    return { personId, locationId };
  }

  it("stores an absence defaulting status to requested with a null note", async () => {
    const { personId } = await seedPersonAndLocation();
    const id = await insertAbsence(suite.db, { personId, status: "requested" });
    const rows = await suite.db.execute<{ status: string; note: string | null }>(sql`
      select status, note from absences where id = ${id}`);
    expect(rows.rows[0]).toEqual({ status: "requested", note: null });
  });

  it("rejects an absence whose ends_on precedes its starts_on", async () => {
    const { personId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      insertAbsence(suite.db, {
        personId,
        startsOn: "2026-03-10",
        endsOn: "2026-03-05",
      }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/absences_range_ck/);
  });

  it("rejects an absence_kind outside the enum", async () => {
    const { personId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      insertAbsence(suite.db, { personId, kind: "sabbatical" }),
    );
    // The enum TYPE's refusal is a named CHECK constraint here (`enumCheck`); see the persons-role
    // case above for the class change.
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/absences_absence_kind_ck/);
  });

  it("rejects an availability weekday outside 0–6", async () => {
    const { personId } = await seedPersonAndLocation();
    const error = await captureError(() => insertAvailability(suite.db, { personId, weekday: 7 }));
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/availability_weekday_ck/);
  });

  it("rejects an availability window whose end is not after its start", async () => {
    const { personId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      insertAvailability(suite.db, {
        personId,
        availableFromMinute: 600,
        availableToMinute: 600,
      }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/availability_window_ck/);
  });

  it("rejects an availability effective_to before its effective_from", async () => {
    const { personId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      insertAvailability(suite.db, {
        personId,
        effectiveFrom: "2026-06-01",
        effectiveTo: "2026-01-01",
      }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/availability_effective_ck/);
  });

  it("rejects a shift_template with an empty label", async () => {
    const { locationId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      insertShiftTemplate(suite.db, { locationId, label: "" }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/shift_templates_label_ck/);
  });

  it("rejects a shift_template weekday outside 0–6", async () => {
    const { locationId } = await seedPersonAndLocation();
    const error = await captureError(() =>
      insertShiftTemplate(suite.db, { locationId, weekday: -1 }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/shift_templates_weekday_ck/);
  });

  it("stores a shift_swap defaulting status to requested, and cascades it away when its from_shift is deleted", async () => {
    // Also proves the from_shift FK is ON DELETE cascade: a swap is meaningless once its offered
    // shift is gone, so deleting the shift discards the swap (changing the FK to `restrict` fails the
    // delete; to `set null` leaves the row and fails the count-0 assertion).
    const { personId, locationId } = await seedPersonAndLocation();
    const toPerson = await seedPerson(suite.db, `d22to-${crypto.randomUUID()}`);
    const fromShiftId = await insertDraftShift(suite.db, { personId, locationId });
    const swapId = await insertShiftSwap(suite.db, {
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
      sql`select count(*) as n from shift_swaps where id = ${swapId}`,
    );
    expect(after.rows[0]!.n).toBe(0);
  });

  it("rejects a shift_swap whose from_shift references no shift", async () => {
    const { personId } = await seedPersonAndLocation();
    const toPerson = await seedPerson(suite.db, `d22to-${crypto.randomUUID()}`);
    const error = await captureError(() =>
      insertShiftSwap(suite.db, {
        requestedByPersonId: personId,
        fromShiftId: crypto.randomUUID(),
        toPersonId: toPerson,
      }),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });
});

describe("the workforce set carries no tenant column", () => {
  const TABLES = [
    "employments",
    "time_entries",
    "workforce_chains",
    "roster_versions",
    "shifts",
    "absences",
    "availability",
    "shift_templates",
    "shift_swaps",
  ];

  /**
   * One table's columns, as the engine's own catalogue reports them.
   *
   * `pragma table_info` replaces `information_schema.columns`, which SQLite does not have. `pk` is
   * 0 for an ordinary column and the column's 1-based position in the primary key otherwise, which
   * is what makes a composite key readable in declaration order. The table name is written into
   * the statement rather than bound: `pragma table_info(?)` is refused at prepare time with
   * `near "?": syntax error` (measured, and recorded on `packages/db/src/deployment.ts`), and the
   * names here are this file's own constants, never input.
   */
  async function columnsOf(table: string) {
    return (
      await suite.db.execute<{ name: string; pk: number }>(
        sql`pragma table_info(${sql.raw(`'${table}'`)})`,
      )
    ).rows;
  }

  it("has no tenant_id column on any of its tables", async () => {
    const found: string[] = [];
    for (const table of TABLES)
      for (const column of await columnsOf(table))
        if (column.name === "tenant_id") found.push(`${table}.${column.name}`);
    expect(found).toEqual([]);
  });

  it("keys the working-time chain head by (node_id, location_id) alone", async () => {
    const key = (await columnsOf("workforce_chains"))
      .filter((column) => column.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map((column) => column.name);
    expect(key).toEqual(["node_id", "location_id"]);
  });

  /**
   * The indexes, read off `sqlite_master` and `pragma index_info` in place of `pg_indexes`.
   *
   * `sql is null` is the filter, not a name pattern: SQLite stores no statement for an index it
   * created itself for a `PRIMARY KEY` or a single-column `UNIQUE` declaration, so those are not
   * the migration's own indexes and are skipped. The partial index's WHERE clause is not reported
   * by `pragma index_info`, so it is read out of the stored `CREATE INDEX` text — which is the only
   * place SQLite keeps it.
   */
  it("rebuilds the multi-column keys on their remaining columns", async () => {
    const indexes: Record<string, { columns: string; sql: string }> = {};
    for (const table of TABLES) {
      const rows = (
        await suite.db.execute<{ name: string; sql: string | null }>(
          sql`select name, sql from sqlite_master where type = 'index' and tbl_name = ${table}`,
        )
      ).rows;
      for (const row of rows) {
        if (row.sql === null) continue;
        const columns = (
          await suite.db.execute<{ name: string }>(
            sql`pragma index_info(${sql.raw(`'${row.name}'`)})`,
          )
        ).rows;
        indexes[row.name] = {
          columns: columns.map((column) => column.name).join(", "),
          sql: row.sql,
        };
      }
    }
    expect(indexes["time_entries_chain_position_uq"]!.columns).toBe(
      "node_id, location_id, sequence_no",
    );
    expect(indexes["roster_versions_published_period_uq"]!.columns).toBe(
      "location_id, period_start, period_end",
    );
    expect(indexes["roster_versions_published_period_uq"]!.sql).toContain(
      `WHERE "roster_versions"."status" = 'published'`,
    );
    expect(indexes["absences_person_idx"]!.columns).toBe("person_id, starts_on");
    expect(indexes["availability_person_idx"]!.columns).toBe("person_id");
    expect(indexes["employments_person_idx"]!.columns).toBe("person_id");
    expect(indexes["roster_versions_location_idx"]!.columns).toBe("location_id");
    expect(indexes["shifts_person_starts_idx"]!.columns).toBe("person_id, starts_at");
    expect(indexes["shift_templates_location_idx"]!.columns).toBe("location_id");
    expect(indexes["shift_swaps_from_shift_idx"]!.columns).toBe("from_shift_id");
    expect(indexes["time_entries_person_event_idx"]!.columns).toBe("person_id, event_at");
    expect(Object.keys(indexes).filter((name) => name.includes("tenant"))).toEqual([]);
  });
});
