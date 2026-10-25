// Weaker than its name: it finds a person's table only through declared foreign keys, so a person
// id held without one, or inside a JSON column (`attendance_response_commands.input`,
// `pay_period_closures.snapshot`, `attendance_questions.evidence_keys`), is not seen, nor is a
// JSON list of ids of rows that name a person (`attendance_day_work.deferred_shift_ids`, shift
// ids); and it proves a column was classified, not that WORKFORCE_PERSONAL_DATA honours the
// classification (personal-data.test.ts's exact-files cases do that).
import { is } from "drizzle-orm";
import { SQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema/index.js";

type Classification =
  { readonly in: readonly string[]; readonly out: readonly string[] } | "working-time record";

const CLASSIFIED: Record<string, Classification> = {
  employments: {
    in: [
      "contract_type",
      "contracted_minutes_per_week",
      "start_date",
      "end_date",
      "pay_rate",
      "created_at",
    ],
    out: ["id", "person_id"],
  },
  absences: {
    in: [
      "absence_kind",
      "starts_on",
      "ends_on",
      "status",
      "note",
      "decided_by_person_id",
      "decided_at",
      "created_at",
    ],
    out: ["id", "person_id"],
  },
  availability: {
    in: [
      "weekday",
      "available_from_minute",
      "available_to_minute",
      "effective_from",
      "effective_to",
      "created_at",
    ],
    out: ["id", "person_id"],
  },
  shifts: {
    in: [
      "location_id",
      "starts_at",
      "starts_offset_minutes",
      "ends_at",
      "ends_offset_minutes",
      "roster_version_id",
      "created_at",
    ],
    out: ["id", "person_id"],
  },
  roster_versions: {
    in: ["status"],
    out: [
      "id",
      "location_id",
      "period_start",
      "period_end",
      "published_at",
      "created_at",
      "published_by_person_id",
    ],
  },
  shift_swaps: {
    in: [
      "requested_by_person_id",
      "to_person_id",
      "status",
      "decided_by_person_id",
      "decided_at",
      "created_at",
    ],
    out: ["id", "from_shift_id", "to_shift_id"],
  },
  attendance_questions: {
    in: [
      "business_day",
      "kind",
      "missing_kinds",
      "start_at",
      "end_at",
      "created_at",
      "active",
      "inactive_reason",
    ],
    out: [
      "id",
      "person_id",
      "location_id",
      "canonical_question_id",
      "shift_key",
      "evidence_keys",
      "open_entry_id",
      "automatic_entry_id",
      "resolved_by_entry_id",
    ],
  },
  attendance_mail: {
    in: ["recipient", "status", "outcome", "claimed_at", "next_attempt_at"],
    out: ["id", "question_id", "claim_token"],
  },
  attendance_response_commands: {
    in: ["action", "requested_by_person_id", "authorized_by_person_id", "input", "created_at"],
    out: ["id", "person_id", "location_id", "question_id", "entry_ids"],
  },
  attendance_operation_facts: {
    in: ["source", "kind", "at", "offset_minutes", "business_day", "outcome"],
    out: ["sequence", "person_id", "location_id", "key"],
  },
  time_entries: "working-time record",
  workforce_chains: {
    in: [],
    out: [
      "node_id",
      "location_id",
      "sequence_no",
      "last_entry_id",
      "last_entry_hash",
      "last_recorded_at",
      "updated_at",
    ],
  },
};

const tables = Object.values(schema as Record<string, unknown>).flatMap((value) =>
  is(value, SQLiteTable) ? [value] : [],
);

/** Whether a foreign key leads from `table` to `persons`, directly or through other tables. */
function reachesPersons(table: SQLiteTable, visited = new Set<SQLiteTable>()): boolean {
  if (visited.has(table)) return false;
  visited.add(table);
  return getTableConfig(table).foreignKeys.some((key) => {
    const target = key.reference().foreignTable;
    return getTableConfig(target).name === "persons" || reachesPersons(target, visited);
  });
}

const personTables = tables.filter((table) => reachesPersons(table)).map(getTableConfig);

describe("workforce personal-data classification", () => {
  it("covers every workforce table that reaches a person by foreign key, and no other", () => {
    expect(personTables.map((config) => config.name).sort()).toEqual(
      Object.keys(CLASSIFIED).sort(),
    );
  });

  it.each(personTables.map((config) => [config.name, config] as const))(
    "classifies every column of %s exactly once",
    (name, config) => {
      expect(Object.keys(CLASSIFIED)).toContain(name);
      const classification = CLASSIFIED[name]!;
      if (classification === "working-time record") return;
      const { in: included, out: excluded } = classification;
      expect(included.filter((column) => excluded.includes(column))).toEqual([]);
      expect(config.columns.map((c) => c.name).sort()).toEqual([...included, ...excluded].sort());
    },
  );
});
