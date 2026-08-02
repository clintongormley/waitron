import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as api from "./index.js";

describe("the public surface", () => {
  it("exports exactly the intended names", () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        "WORKFORCE_MIGRATIONS",
        "persons",
        "personStatus",
        "workforceRole",
        "employments",
        "timeEntries",
        "workforceCorrectionStatus",
        "workforceEntryKind",
        "workforceChains",
        "appendToChain",
        "isUniqueViolation",
        "lockChainHead",
        "computeEntryHash",
        "verifyChain",
        "hashPin",
        "verifyPin",
        "WorkforceBackend",
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
 * it, which is why persons.ts's FK/index/check block shows as uncovered even though every other test
 * imports the table. Calling `getTableConfig` forces the callback to run, and the assertions below
 * are the meaningful check that persons' constraints exist under the names the migration and the RLS
 * policy depend on — not a coverage stunt. Mirrors packages/credentials/src/index.test.ts.
 */
describe("persons constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares persons' primary key, foreign key and check constraints", () => {
    const config = getTableConfig(api.persons);

    // The PK is inline on `id` (a column flag), not a composite in extraConfig; the FK, index and
    // checks below ARE in extraConfig, so asserting them is what forces the lazy callback to run.
    expect(config.columns.find((c) => c.name === "id")?.primary).toBe(true);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toContain("persons_tenant_fk");

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("persons_display_name_ck");
    expect(checkNames).toContain("persons_pin_hash_ck");
  });
});

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
