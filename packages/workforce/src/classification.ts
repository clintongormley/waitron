import { appendOnly, classify, type ClassifiedTable } from "@waitron/sync-enrolment";
import type { ChangeSource } from "@waitron/shared";

const LEDGER = "what happened, keyed by the writing node; drained back from a returned box";
const STATE = "manager configuration / live service; copied to a standby, never drained back";

export const WORKFORCE_OWN_CLASSIFICATION: readonly ClassifiedTable[] = [
  appendOnly("time_entries", "ledger", LEDGER),
  appendOnly("pay_period_closures", "ledger", LEDGER),
  classify("pay_period_settings", "state", STATE),
  classify("employments", "state", STATE),
  classify("shifts", "state", STATE),
  classify("shift_templates", "state", STATE),
  classify("shift_swaps", "state", STATE),
  classify("absences", "state", STATE),
  classify("availability", "state", STATE),
  classify("roster_versions", "state", STATE),
  ...[
    "attendance_days",
    "staff_activity",
    "attendance_questions",
    "attendance_answers",
  ].map((name) =>
    classify(
      name,
      "state",
      "attendance processing, questions and delivery state; copied with the venue",
    ),
  ),
];

/** Every table in workforce's set: workforce's own and staffing's, which lives in it. */
export const WORKFORCE_CLASSIFICATION: readonly ClassifiedTable[] = [
  ...WORKFORCE_OWN_CLASSIFICATION,
  classify("staffing_days", "state", "an area's painted staffing day"),
  classify("staffing_blocks", "state", "one painted staffing need"),
];

export const WORKFORCE_CHANGE_SOURCES: readonly ChangeSource[] = WORKFORCE_OWN_CLASSIFICATION.map(
  ({ table }) => ({ table, type: table }),
);
