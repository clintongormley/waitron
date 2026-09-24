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
  // Core for the `tenants` row the setup seeds and the `locations` and `nodes` rows the cases seed
  // (`seedLocation`, `seedNode`); identity for `persons`, which the cases write and workforce's
  // tables reference.
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
  },
});

const PIN = hashPin("1234");

/** `id` and `created_at` come from `$defaultFn` generators a raw insert does not run. The inserts
 * stay raw because they test what the MIGRATION declares, not what drizzle would send. */
function rowIdentity() {
  return sql`${newId()}, ${nowIso()}`;
}

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
    // The name as well as the class: any other check on this table would satisfy the class.
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
    // Every other column valid, so the row cannot be refused on the wrong constraint.
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
    // Every other column valid, so ONLY the offset check is violated.
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
    // A valid position-1 entry; the cases below write at position 2, so they never collide on
    // time_entries_chain_position_uq. `.000Z` because the whole-second checks demand it.
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
    // corrects_entry_id set but the other three correction columns null: neither shape.
    const { personId, locationId, nodeId, entryId } = await seedBaseEntry();
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
    const { personId, locationId, nodeId } = await seedBaseEntry();
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
    const { personId, locationId, nodeId } = await seedBaseEntry();
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
    // SQLite names the index's columns, not the index; these three are
    // `roster_versions_published_period_uq`'s.
    expect(engineErrorMessage(error)).toMatch(
      /UNIQUE constraint failed: roster_versions\.location_id, roster_versions\.period_start, roster_versions\.period_end/,
    );
  });

  it("allows two DRAFT versions for the same period — the published-only index is partial", async () => {
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
    // A swap is meaningless once its offered shift is gone, so the from_shift FK cascades.
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
   * `pk` is the column's 1-based position in the primary key, 0 otherwise. The table name is written
   * into the statement because `pragma table_info(?)` does not prepare; the names are this file's
   * own constants, never input.
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
   * A null `sql` marks an index SQLite created itself for a key, not one the migration declared.
   * `pragma index_info` does not report a partial index's WHERE, so it is read from the stored text.
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
