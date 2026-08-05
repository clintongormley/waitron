import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as api from "./index.js";

describe("the public surface", () => {
  it("exports exactly the intended names", () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        "WORKFORCE_MIGRATIONS",
        "employments",
        "timeEntries",
        "workforceCorrectionStatus",
        "workforceEntryKind",
        "workforceChains",
        "rosterVersions",
        "rosterVersionStatus",
        "shifts",
        "absences",
        "absenceKind",
        "absenceStatus",
        "availability",
        "shiftTemplates",
        "shiftSwaps",
        "shiftSwapStatus",
        "createAbsence",
        "setAbsenceStatus",
        "requestSwap",
        "acceptSwap",
        "appendToChain",
        "isUniqueViolation",
        "lockChainHead",
        "computeEntryHash",
        "verifyChain",
        "WorkforceBackend",
        "validateRoster",
        "comparePlannedVsActual",
        "projectWorkSessions",
        "summarisePeriod",
        "dailyContractedTargetMinutes",
        "localWallClock",
      ].sort(),
    );
  });
});

/**
 * drizzle invokes each table's `(t) => [...]` extraConfig callback LAZILY — a plain import never runs
 * it, which is why a schema file's FK/index/check block shows as uncovered even though every other
 * test imports the table. Calling `getTableConfig` forces the callback to run, and the assertions
 * below are the meaningful check that each table's constraints exist under the names the migration
 * and the RLS policy depend on — not a coverage stunt. Mirrors packages/credentials/src/index.test.ts.
 * (persons moved to @waitron/identity, which owns its own such block now.)
 */
describe("employments constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares employments' foreign keys and check constraints", () => {
    const config = getTableConfig(api.employments);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toContain("employments_tenant_fk");
    expect(fkNames).toContain("employments_person_fk");

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("employments_contracted_minutes_ck");
    expect(checkNames).toContain("employments_dates_ck");
  });
});

describe("time_entries constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares time_entries' five foreign keys and the offset check", () => {
    const config = getTableConfig(api.timeEntries);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toEqual(
      expect.arrayContaining([
        "time_entries_tenant_fk",
        "time_entries_person_fk",
        "time_entries_location_fk",
        "time_entries_captured_by_till_fk",
        "time_entries_recorded_by_person_fk",
        // Slice 3: the self-referential correction target and the correction actor.
        "time_entries_corrects_entry_fk",
        "time_entries_correction_actor_fk",
      ]),
    );

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("time_entries_event_offset_ck");
    // Slice 3: a row is all-base or all-correction, never half of each.
    expect(checkNames).toContain("time_entries_correction_shape_ck");
    // Slice 4: the tamper-evidence chain shape and hash format.
    expect(checkNames).toContain("time_entries_entry_hash_ck");
    expect(checkNames).toContain("time_entries_sequence_no_ck");
    expect(checkNames).toContain("time_entries_chaining_ck");
    // Slice 4 defence-in-depth: event_at must carry no sub-second component (whole-branch review).
    expect(checkNames).toContain("time_entries_event_at_second_ck");

    // `ingest_seq` is GENERATED ALWAYS AS IDENTITY — the app cannot forge the append order.
    const ingest = config.columns.find((c) => c.name === "ingest_seq");
    expect(ingest?.generatedIdentity?.type).toBe("always");
  });
});

describe("workforce_chains constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares the chain head's composite key, foreign keys and pointer check", () => {
    const config = getTableConfig(api.workforceChains);

    // The PK is the composite (tenant_id, location_id) in extraConfig — asserting it forces the
    // lazy callback to run.
    expect(config.primaryKeys.map((pk) => pk.getName())).toContain(
      "workforce_chains_tenant_id_location_id_pk",
    );

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toEqual(
      expect.arrayContaining([
        "workforce_chains_tenant_id_tenants_id_fk",
        "workforce_chains_location_id_locations_id_fk",
        "workforce_chains_last_entry_id_time_entries_id_fk",
      ]),
    );

    expect(config.checks.map((c) => c.name)).toContain("workforce_chains_pointer_ck");
  });
});

describe("roster_versions constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares roster_versions' foreign keys and check constraints", () => {
    const config = getTableConfig(api.rosterVersions);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toEqual(
      expect.arrayContaining([
        "roster_versions_tenant_fk",
        "roster_versions_location_fk",
        "roster_versions_published_by_person_fk",
      ]),
    );

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("roster_versions_period_ck");
    expect(checkNames).toContain("roster_versions_publish_shape_ck");
  });
});

describe("shifts constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares shifts' four foreign keys and its offset/interval checks", () => {
    const config = getTableConfig(api.shifts);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toEqual(
      expect.arrayContaining([
        "shifts_tenant_fk",
        "shifts_person_fk",
        "shifts_location_fk",
        // The roster-version link, SET NULL on delete — a discarded version detaches its shifts.
        "shifts_roster_version_fk",
      ]),
    );

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("shifts_starts_offset_ck");
    expect(checkNames).toContain("shifts_ends_offset_ck");
    expect(checkNames).toContain("shifts_interval_ck");
  });
});

describe("absences constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares absences' foreign keys and its range check", () => {
    const config = getTableConfig(api.absences);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toEqual(expect.arrayContaining(["absences_tenant_fk", "absences_person_fk"]));

    expect(config.checks.map((c) => c.name)).toContain("absences_range_ck");
  });
});

describe("availability constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares availability's foreign keys and its window/effective checks", () => {
    const config = getTableConfig(api.availability);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toEqual(
      expect.arrayContaining(["availability_tenant_fk", "availability_person_fk"]),
    );

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("availability_weekday_ck");
    expect(checkNames).toContain("availability_from_minute_ck");
    expect(checkNames).toContain("availability_to_minute_ck");
    expect(checkNames).toContain("availability_window_ck");
    expect(checkNames).toContain("availability_effective_ck");
  });
});

describe("shift_templates constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares shift_templates' foreign keys and its label/weekday/minute checks", () => {
    const config = getTableConfig(api.shiftTemplates);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toEqual(
      expect.arrayContaining(["shift_templates_tenant_fk", "shift_templates_location_fk"]),
    );

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("shift_templates_label_ck");
    expect(checkNames).toContain("shift_templates_weekday_ck");
    expect(checkNames).toContain("shift_templates_starts_minute_ck");
    expect(checkNames).toContain("shift_templates_ends_minute_ck");
  });
});

describe("shift_swaps constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares shift_swaps' five foreign keys, incl. the cascade/set-null shift links", () => {
    const config = getTableConfig(api.shiftSwaps);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toEqual(
      expect.arrayContaining([
        "shift_swaps_tenant_fk",
        "shift_swaps_requested_by_person_fk",
        "shift_swaps_to_person_fk",
        // from_shift cascades (a swap dies with its offered shift), to_shift SET NULLs.
        "shift_swaps_from_shift_fk",
        "shift_swaps_to_shift_fk",
      ]),
    );
  });
});
