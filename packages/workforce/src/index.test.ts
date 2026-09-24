import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as api from "./index.js";

describe("the public surface", () => {
  it("exports exactly the intended names", () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        "WORKFORCE_CHANGE_SOURCES",
        "WORKFORCE_CLASSIFICATION",
        "WORKFORCE_CONFIGURATION_TRANSFER",
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
        "listPendingAbsences",
        "requestSwap",
        "acceptSwap",
        "decideSwap",
        "listPendingSwaps",
        "listShiftsForPerson",
        "listSwapsForPerson",
        "listAbsencesForPerson",
        "appendToChain",
        "readChainHead",
        "readChain",
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
 * drizzle runs each table's extraConfig callback lazily, so a plain import never reaches it;
 * `getTableConfig` forces it, and these assertions check each constraint's name.
 */
describe("employments constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares employments' foreign keys and check constraints", () => {
    const config = getTableConfig(api.employments);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toContain("employments_person_fk");

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("employments_contracted_minutes_ck");
    expect(checkNames).toContain("employments_dates_ck");
  });
});

describe("time_entries constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares time_entries' seven foreign keys and the offset/second checks", () => {
    const config = getTableConfig(api.timeEntries);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toEqual(
      expect.arrayContaining([
        "time_entries_person_fk",
        "time_entries_location_fk",
        "time_entries_captured_by_till_fk",
        "time_entries_recorded_by_person_fk",
        "time_entries_node_fk",
        "time_entries_corrects_entry_fk",
        "time_entries_correction_actor_fk",
      ]),
    );

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("time_entries_event_offset_ck");
    expect(checkNames).toContain("time_entries_correction_shape_ck");
    expect(checkNames).toContain("time_entries_entry_hash_ck");
    expect(checkNames).toContain("time_entries_sequence_no_ck");
    expect(checkNames).toContain("time_entries_chaining_ck");
    expect(checkNames).toContain("time_entries_event_at_second_ck");
    expect(checkNames).toContain("time_entries_recorded_at_second_ck");

    expect(config.columns.map((c) => c.name)).not.toContain("ingest_seq");
    expect(config.columns.map((c) => c.name)).toContain("node_id");
    expect(config.columns.map((c) => c.name)).toContain("recorded_at");
  });
});

describe("workforce_chains constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares the chain head's composite key, foreign keys and pointer check", () => {
    const config = getTableConfig(api.workforceChains);

    expect(config.primaryKeys.map((pk) => pk.getName())).toContain(
      "workforce_chains_node_id_location_id_pk",
    );

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toEqual(
      expect.arrayContaining([
        "workforce_chains_node_id_nodes_id_fk",
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
  it("declares shifts' three foreign keys and its offset/interval checks", () => {
    const config = getTableConfig(api.shifts);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toEqual(
      expect.arrayContaining([
        "shifts_person_fk",
        "shifts_location_fk",
        // SET NULL on delete: a discarded version detaches its shifts.
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
    expect(fkNames).toEqual(
      expect.arrayContaining([
        "absences_person_fk",
        // The manager who decided the absence.
        "absences_decided_by_person_fk",
      ]),
    );

    expect(config.checks.map((c) => c.name)).toContain("absences_range_ck");
  });
});

describe("availability constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares availability's foreign keys and its window/effective checks", () => {
    const config = getTableConfig(api.availability);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toEqual(expect.arrayContaining(["availability_person_fk"]));

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
    expect(fkNames).toEqual(expect.arrayContaining(["shift_templates_location_fk"]));

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
        "shift_swaps_requested_by_person_fk",
        "shift_swaps_to_person_fk",
        // from_shift cascades, to_shift SET NULLs.
        "shift_swaps_from_shift_fk",
        "shift_swaps_to_shift_fk",
        "shift_swaps_decided_by_person_fk",
      ]),
    );
  });
});
