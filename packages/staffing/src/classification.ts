import type { ChangeSource } from "@waitron/shared";

/** The tables this module's code owns. They live in workforce's set, which classifies them. */
export const STAFFING_TABLES = [
  "staff_roles",
  "person_staff_roles",
  "staffing_days",
  "staffing_blocks",
  "shift_assignments",
] as const;

export const STAFFING_CHANGE_SOURCES: readonly ChangeSource[] = STAFFING_TABLES.map((table) => ({
  table,
  type: table,
}));
