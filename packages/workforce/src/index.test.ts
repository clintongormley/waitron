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
        "workforceEntryKind",
        "hashPin",
        "verifyPin",
        "WorkforceBackend",
        "projectWorkSessions",
        "summarisePeriod",
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
      ]),
    );

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("time_entries_event_offset_ck");

    // `ingest_seq` is GENERATED ALWAYS AS IDENTITY — the app cannot forge the append order.
    const ingest = config.columns.find((c) => c.name === "ingest_seq");
    expect(ingest?.generatedIdentity?.type).toBe("always");
  });
});
