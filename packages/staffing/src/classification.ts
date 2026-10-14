import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";
import type { ChangeSource } from "@waitron/shared";

export const STAFFING_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify("staff_roles", "state", "the venue's job positions, which an owner edits"),
  classify("person_staff_roles", "state", "which staff roles a person can fill"),
  classify("staffing_days", "state", "an area's painted staffing day"),
  classify("staffing_blocks", "state", "one painted staffing need"),
  classify("shift_assignments", "state", "the area and staff role a shift fills"),
];

export const STAFFING_CHANGE_SOURCES: readonly ChangeSource[] = STAFFING_CLASSIFICATION.map(
  ({ table }) => ({ table, type: table }),
);
