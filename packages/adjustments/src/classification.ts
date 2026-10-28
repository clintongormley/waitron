import { appendOnly, classify, type ClassifiedTable } from "@waitron/sync-enrolment";
import type { ChangeSource } from "@waitron/shared";

export const ADJUSTMENTS_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify(
    "adjustment_reasons",
    "state",
    "venue adjustment policy an owner edits; copied to a standby, never drained back",
  ),
  appendOnly(
    "adjustments",
    "ledger",
    "what was taken off a bill, by whom and under which reason; nothing may change or remove it",
  ),
  classify(
    "adjustment_settings",
    "state",
    "venue discount limit an owner edits; copied to a standby, never drained back",
  ),
  appendOnly(
    "adjustment_refunds",
    "ledger",
    "which cancelled dishes a refund paid back, and how much of it; nothing may change or remove it",
  ),
  appendOnly(
    "adjustment_lines",
    "ledger",
    "which bill lines a comp or discount covered; nothing may change or remove it",
  ),
];

export const ADJUSTMENTS_CHANGE_SOURCES: readonly ChangeSource[] = ADJUSTMENTS_CLASSIFICATION.map(
  ({ table }) => ({ table, type: table }),
);
