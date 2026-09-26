import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";
import type { ChangeSource } from "@waitron/shared";

export const ADJUSTMENTS_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify(
    "adjustment_reasons",
    "state",
    "venue adjustment policy an owner edits; copied to a standby, never drained back",
  ),
];

export const ADJUSTMENTS_CHANGE_SOURCES: readonly ChangeSource[] = ADJUSTMENTS_CLASSIFICATION.map(
  ({ table }) => ({ table, type: table }),
);
